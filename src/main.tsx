import React from "react";
import ReactDOM from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@xterm/xterm/css/xterm.css";
import "./app/layouts/viewport.css";
import "./app/components/yaml-editor.css";
import "./app/components/table-composition.css";
import "./app/components/connected-toolbar.css";
import "./app/cluster/resource-inspector.css";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
