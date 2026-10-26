import React from "react";
import ReactDOM from "react-dom/client";
import "@astryxdesign/core/reset.css";
import "@astryxdesign/core/astryx.css";
import "@xterm/xterm/css/xterm.css";
import "./app/layouts/viewport.css";
import { Theme } from "@astryxdesign/core/theme";
import { brandTheme } from "./themes/brand";
import App from "./App";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <Theme theme={brandTheme}>
      <App />
    </Theme>
  </React.StrictMode>,
);
