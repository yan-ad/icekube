/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

const statusElement = document.getElementById("status");
const detailsElement = document.getElementById("details");

async function start() {
  try {
    const status = await window.__TAURI__.core.invoke("runtime_status");

    detailsElement.textContent = JSON.stringify(status, null, 2);
    statusElement.textContent = "Tauri → Node → Tauri communication is ready.";
    document.documentElement.dataset.runtime = "ready";

    await window.__TAURI__.core.invoke("runtime_ready");
  } catch (error) {
    statusElement.textContent = "Backend startup failed.";
    detailsElement.textContent = String(error);
    document.documentElement.dataset.runtime = "failed";
  }
}

void start();
