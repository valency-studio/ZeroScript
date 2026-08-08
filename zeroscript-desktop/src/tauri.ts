// SPDX-License-Identifier: GPL-3.0-or-later
import { invoke } from "@tauri-apps/api/core";

export interface AppInfo {
  version: string;
  os: string;
}

export const startBridge = (): Promise<void> => invoke("start_bridge");
export const stopBridge = (): Promise<void> => invoke("stop_bridge");
export const restartBridge = (): Promise<void> => invoke("restart_bridge");
export const bridgeRunning = (): Promise<boolean> => invoke("bridge_running");
export const getDataDir = (): Promise<string> => invoke("get_data_dir");
export const openDataDir = (): Promise<void> => invoke("open_data_dir");
export const getAppInfo = (): Promise<AppInfo> => invoke("get_app_info");
