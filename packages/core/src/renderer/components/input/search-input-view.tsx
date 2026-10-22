/**
 * Copyright (c) Freelens Authors. All rights reserved.
 * Licensed under MIT License. See LICENSE in root directory for more information.
 */

import "./search-input.scss";
import { useEffect, useRef, useState } from "react";
import { MaterialIconView } from "../../../../../ui-components/icon/src/icon-view";
import { InputView } from "./input-view";

/** Controlled browser adapter for the shared Input/SearchInput presentation. */
export function SearchInputView({
  value,
  onChange,
  label = "Search...",
}: {
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  const [focused, setFocused] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const focus = (event: KeyboardEvent) => {
      const isMac = /Mac|iPhone|iPad/.test(navigator.platform);
      if (event.key === "f" && (isMac ? event.metaKey : event.ctrlKey)) input.current?.focus();
    };
    window.addEventListener("keydown", focus);
    return () => window.removeEventListener("keydown", focus);
  }, []);
  return (
    <InputView
      className={`Input SearchInput${focused ? " focused" : ""}`}
      inputProps={{
        ref: input,
        className: "input grow",
        value,
        autoFocus: true,
        placeholder: "Search...",
        "aria-label": label,
        spellCheck: false,
        onChange: (event) => onChange(event.target.value),
        onFocus: () => setFocused(true),
        onBlur: () => setFocused(false),
        onKeyDown: (event) => {
          if (event.key === "Escape") {
            onChange("");
            event.stopPropagation();
          }
        },
      }}
      iconRight={
        <MaterialIconView
          small
          material={value ? "close" : "search"}
          className={value ? "interactive" : ""}
          role={value ? "button" : undefined}
          aria-label={value ? "Clear search" : undefined}
          aria-hidden={value ? undefined : true}
          tabIndex={value ? 0 : undefined}
          onClick={value ? () => onChange("") : undefined}
          onKeyDown={(event) => {
            if (value && (event.key === "Enter" || event.key === " ")) {
              event.preventDefault();
              onChange("");
            }
          }}
        />
      }
    />
  );
}
