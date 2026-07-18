#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum FileType {
    Jpeg,
    Png,
    Pdf,
    Zip,
    Mp3,
}

pub const ALL_TYPES: [FileType; 5] =
    [FileType::Jpeg, FileType::Png, FileType::Pdf, FileType::Zip, FileType::Mp3];

/// The longest start marker across every supported type (PNG's 8-byte magic) -- callers scanning
/// consecutive chunks carry over this many bytes minus one from one chunk into the next so a
/// signature straddling the boundary is still detected, exactly once.
pub const MAX_START_MARKER_LEN: usize = 8;

impl FileType {
    /// Parses one of the plugin-facing type identifiers ("jpeg", "png", "pdf", "zip", "mp3").
    pub fn parse(name: &str) -> Result<Self, String> {
        match name {
            "jpeg" => Ok(FileType::Jpeg),
            "png" => Ok(FileType::Png),
            "pdf" => Ok(FileType::Pdf),
            "zip" => Ok(FileType::Zip),
            "mp3" => Ok(FileType::Mp3),
            other => Err(format!("Unknown file type '{other}'")),
        }
    }

    pub fn extension(&self) -> &'static str {
        match self {
            FileType::Jpeg => "jpg",
            FileType::Png => "png",
            FileType::Pdf => "pdf",
            FileType::Zip => "zip",
            FileType::Mp3 => "mp3",
        }
    }

    /// Destination subfolder name -- also used as the key in `RecoveryProgress`'s
    /// `files_found_by_type` map, so the two stay in sync automatically.
    pub fn subfolder(&self) -> &'static str {
        match self {
            FileType::Jpeg => "jpeg",
            FileType::Png => "png",
            FileType::Pdf => "pdf",
            FileType::Zip => "zip",
            FileType::Mp3 => "mp3",
        }
    }

    /// Max bytes to extract for a single recovered file of this type. Caps runaway extraction
    /// when an end marker is missing (ZIP, MP3 -- neither has one this carving approach can rely
    /// on) or wasn't found within a sane size (JPEG, PNG, PDF -- e.g. because the true end was
    /// already overwritten by something else).
    pub fn max_size(&self) -> usize {
        match self {
            FileType::Jpeg => 20 * 1024 * 1024,
            FileType::Png => 20 * 1024 * 1024,
            FileType::Pdf => 50 * 1024 * 1024,
            FileType::Zip => 100 * 1024 * 1024,
            FileType::Mp3 => 20 * 1024 * 1024,
        }
    }

    fn start_marker(&self) -> &'static [u8] {
        match self {
            FileType::Jpeg => &[0xFF, 0xD8, 0xFF],
            FileType::Png => &[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A],
            FileType::Pdf => b"%PDF",
            FileType::Zip => &[0x50, 0x4B, 0x03, 0x04],
            FileType::Mp3 => b"ID3",
        }
    }

    fn end_marker(&self) -> Option<&'static [u8]> {
        match self {
            FileType::Jpeg => Some(&[0xFF, 0xD9]),
            FileType::Png => Some(&[0x49, 0x45, 0x4E, 0x44, 0xAE, 0x42, 0x60, 0x82]), // "IEND" + its fixed CRC
            FileType::Pdf => Some(b"%%EOF"),
            FileType::Zip | FileType::Mp3 => None,
        }
    }
}

/// Finds the earliest occurrence of any `enabled_types`' start marker in `data`, only considering
/// match positions >= `min_search_start`. Callers scanning consecutive chunks with a carried-over
/// prefix pass `carry_len.saturating_sub(MAX_START_MARKER_LEN - 1)` here, so a marker fully
/// contained within the carry (already found while scanning the previous chunk) isn't reported a
/// second time, while one straddling the boundary still is.
pub fn find_earliest_start(
    data: &[u8],
    min_search_start: usize,
    enabled_types: &[FileType],
) -> Option<(usize, FileType)> {
    let mut earliest: Option<(usize, FileType)> = None;
    for &file_type in enabled_types {
        let marker = file_type.start_marker();
        if marker.len() > data.len() {
            continue;
        }
        let mut pos = min_search_start;
        while pos + marker.len() <= data.len() {
            if &data[pos..pos + marker.len()] == marker {
                if earliest.map_or(true, |(earliest_pos, _)| pos < earliest_pos) {
                    earliest = Some((pos, file_type));
                }
                break;
            }
            pos += 1;
        }
    }
    earliest
}

fn find_subslice(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    if needle.is_empty() || needle.len() > haystack.len() {
        return None;
    }
    (0..=haystack.len() - needle.len()).find(|&i| &haystack[i..i + needle.len()] == needle)
}

/// Given `data` starting at a detected start marker for `file_type`, returns how many bytes to
/// extract: up to and including the end marker if `file_type` has one and it's found within the
/// type's cap, otherwise exactly the cap (or `data.len()` if shorter) -- extraction is always
/// bounded, never open-ended.
pub fn find_extraction_length(data: &[u8], file_type: FileType) -> usize {
    let cap = file_type.max_size().min(data.len());
    if let Some(marker) = file_type.end_marker() {
        if let Some(found_at) = find_subslice(&data[..cap], marker) {
            return (found_at + marker.len()).min(cap);
        }
    }
    cap
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn finds_a_jpeg_start_marker() {
        let data = [0x00, 0x00, 0xFF, 0xD8, 0xFF, 0x00];
        let result = find_earliest_start(&data, 0, &ALL_TYPES);
        assert_eq!(result, Some((2, FileType::Jpeg)));
    }

    #[test]
    fn finds_the_earliest_of_multiple_markers() {
        let mut data = vec![0u8; 20];
        data[10..13].copy_from_slice(&[0xFF, 0xD8, 0xFF]); // JPEG at 10
        data[2..6].copy_from_slice(b"%PDF"); // PDF at 2, earlier
        let result = find_earliest_start(&data, 0, &ALL_TYPES);
        assert_eq!(result, Some((2, FileType::Pdf)));
    }

    #[test]
    fn returns_none_when_no_marker_present() {
        let data = [0u8; 32];
        assert_eq!(find_earliest_start(&data, 0, &ALL_TYPES), None);
    }

    #[test]
    fn respects_min_search_start_to_avoid_rereporting_the_carry_region() {
        // A JPEG marker at position 1, but min_search_start = 3 means it's in the already-
        // scanned carry region and must not be reported again.
        let data = [0x00, 0xFF, 0xD8, 0xFF, 0x00];
        assert_eq!(find_earliest_start(&data, 3, &ALL_TYPES), None);
    }

    #[test]
    fn still_finds_a_marker_that_starts_exactly_at_min_search_start() {
        let data = [0x00, 0x00, 0x00, 0xFF, 0xD8, 0xFF];
        assert_eq!(find_earliest_start(&data, 3, &ALL_TYPES), Some((3, FileType::Jpeg)));
    }

    #[test]
    fn only_considers_enabled_types() {
        let data = [0xFF, 0xD8, 0xFF];
        assert_eq!(find_earliest_start(&data, 0, &[FileType::Png]), None);
        assert_eq!(find_earliest_start(&data, 0, &[FileType::Jpeg]), Some((0, FileType::Jpeg)));
    }

    #[test]
    fn jpeg_extraction_stops_at_the_end_marker() {
        let data = [0xFF, 0xD8, 0xFF, 0x00, 0x00, 0xFF, 0xD9, 0x00, 0x00];
        assert_eq!(find_extraction_length(&data, FileType::Jpeg), 7);
    }

    #[test]
    fn pdf_extraction_stops_after_percent_percent_eof() {
        let mut data = b"%PDF-1.4 some content ".to_vec();
        data.extend_from_slice(b"%%EOF");
        data.extend_from_slice(b" trailing garbage that should not be included");
        let expected_len = b"%PDF-1.4 some content %%EOF".len();
        assert_eq!(find_extraction_length(&data, FileType::Pdf), expected_len);
    }

    #[test]
    fn zip_has_no_end_marker_and_is_capped_at_max_size() {
        let data = vec![0u8; 200];
        assert_eq!(find_extraction_length(&data, FileType::Zip), 200);
    }

    #[test]
    fn extraction_is_capped_even_when_no_end_marker_is_found_within_the_cap() {
        // A JPEG with no FFD9 anywhere: extraction still stops at data.len() rather than
        // running forever.
        let data = vec![0u8; 50];
        assert_eq!(find_extraction_length(&data, FileType::Jpeg), 50);
    }
}
