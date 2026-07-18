import { describe, expect, it } from "vitest";
import { useConfirmStore } from "./useConfirmStore";

describe("useConfirmStore", () => {
  it("sets the message when a confirmation is requested", () => {
    void useConfirmStore.getState().requestConfirm("Delete this?");

    expect(useConfirmStore.getState().message).toBe("Delete this?");
  });

  it("resolves the returned promise to true and clears the message on confirm", async () => {
    const promise = useConfirmStore.getState().requestConfirm("Delete this?");

    useConfirmStore.getState().resolve(true);

    await expect(promise).resolves.toBe(true);
    expect(useConfirmStore.getState().message).toBeNull();
  });

  it("resolves the returned promise to false and clears the message on cancel", async () => {
    const promise = useConfirmStore.getState().requestConfirm("Delete this?");

    useConfirmStore.getState().resolve(false);

    await expect(promise).resolves.toBe(false);
    expect(useConfirmStore.getState().message).toBeNull();
  });

  it("auto-cancels a still-pending request when a new one is made", async () => {
    const first = useConfirmStore.getState().requestConfirm("First?");
    const second = useConfirmStore.getState().requestConfirm("Second?");

    await expect(first).resolves.toBe(false);
    expect(useConfirmStore.getState().message).toBe("Second?");

    useConfirmStore.getState().resolve(true);
    await expect(second).resolves.toBe(true);
  });
});
