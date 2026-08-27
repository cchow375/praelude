import { invoke } from "@tauri-apps/api/core";
import type { RepReplayApi, RepReplayMeta } from "./types";

export const nativeRepReplayApi: RepReplayApi = {
  list: (repBlockId) =>
    invoke<RepReplayMeta[]>("rep_replay_list", { repBlockId }),
  save: (input) => invoke<RepReplayMeta>("rep_replay_save", { input }),
  read: (id) => invoke<string>("rep_replay_read", { id }),
  delete: (id) => invoke<void>("rep_replay_delete", { id }),
};
