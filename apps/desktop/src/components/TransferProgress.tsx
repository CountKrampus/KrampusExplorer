import { useTransferStore } from "../stores/useTransferStore";
import "./TransferProgress.css";

function TransferProgress() {
  const progress = useTransferStore((state) => state.progress);

  if (!progress) return null;

  const percent = Math.round((progress.copied / progress.total) * 100);

  return (
    <div className="transfer-progress">
      <span className="transfer-progress__label">
        Transferring {progress.copied} of {progress.total}…
      </span>
      <div className="transfer-progress__bar">
        <div className="transfer-progress__fill" style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default TransferProgress;
