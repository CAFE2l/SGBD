"use client";

import { useEffect, useRef } from "react";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { sql, SQLite } from "@codemirror/lang-sql";
import {
  acceptCompletion,
  autocompletion,
  closeCompletion,
  completionStatus,
  moveCompletionSelection,
  startCompletion,
} from "@codemirror/autocomplete";
import { oneDark } from "@codemirror/theme-one-dark";
import {
  emptyCatalog,
  sqlCompletionSource,
  type CompletionCatalog,
  type SqlAcceptMode,
} from "@/lib/sqlite/completions";

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  placeholderText?: string;
  catalog?: CompletionCatalog;
  acceptMode?: SqlAcceptMode;
}

const baseTheme = EditorView.theme({
  "&": {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: "0.75rem",
    fontSize: "13px",
  },
  ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none" },
  ".cm-tooltip-autocomplete": {
    border: "1px solid rgba(255,255,255,0.12)",
    backgroundColor: "rgba(15, 23, 42, 0.96)",
    borderRadius: "0.6rem",
    overflow: "hidden",
  },
  ".cm-tooltip-autocomplete > ul": {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "12px",
  },
  ".cm-tooltip-autocomplete ul li[aria-selected]": {
    backgroundColor: "rgba(56, 189, 248, 0.18)",
  },
  ".cm-completionLabel": { color: "#e2e8f0" },
  ".cm-completionDetail": { color: "#64748b", fontStyle: "normal" },
  ".cm-completionMatchedText": {
    textDecoration: "none",
    fontWeight: 700,
    color: "#7dd3fc",
  },
  ".cm-completionIcon": { opacity: 0.8 },
});

function acceptIfOpen(view: EditorView): boolean {
  return completionStatus(view.state) === "active"
    ? acceptCompletion(view)
    : false;
}

function modeKeymap(mode: SqlAcceptMode) {
  const bindings = [
    { key: "Ctrl-Space", run: startCompletion },
    { mac: "Alt-`", run: startCompletion },
    { mac: "Alt-i", run: startCompletion },
    { key: "Escape", run: closeCompletion },
    { key: "ArrowDown", run: moveCompletionSelection(true) },
    { key: "ArrowUp", run: moveCompletionSelection(false) },
    { key: "PageDown", run: moveCompletionSelection(true, "page") },
    { key: "PageUp", run: moveCompletionSelection(false, "page") },
    { key: "Enter", run: acceptIfOpen },
  ];
  if (mode === "tab") {
    bindings.push({ key: "Tab", run: acceptIfOpen });
  }
  return keymap.of(bindings);
}

export function SqlEditor({
  value,
  onChange,
  onRun,
  placeholderText,
  catalog = emptyCatalog(),
  acceptMode = "tab",
}: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const catalogRef = useRef(catalog);
  const modeCompartment = useRef(new Compartment());
  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  catalogRef.current = catalog;

  useEffect(() => {
    if (!containerRef.current) return;

    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) onChangeRef.current(update.state.doc.toString());
    });

    const extensions: Extension[] = [
      Prec.high(
        keymap.of([
          {
            key: "Mod-Enter",
            preventDefault: true,
            run: () => {
              const view = viewRef.current;
              if (view) closeCompletion(view);
              onRunRef.current?.();
              return true;
            },
          },
        ])
      ),
      autocompletion({
        defaultKeymap: false,
        activateOnTyping: true,
        interactionDelay: 0,
        maxRenderedOptions: 50,
        override: [sqlCompletionSource(() => catalogRef.current)],
        optionClass: (completion) =>
          (completion.boost ?? 0) >= 50 ? "cm-completion-priority" : "",
        activateOnCompletion: (completion) => completion.type === "keyword",
      }),
      Prec.high(modeCompartment.current.of(modeKeymap(acceptMode))),
      basicSetup,
      sql({ dialect: SQLite, upperCaseKeywords: true }),
      oneDark,
      baseTheme,
      EditorView.lineWrapping,
      updateListener,
    ];

    if (placeholderText) extensions.push(placeholder(placeholderText));

    const view = new EditorView({
      state: EditorState.create({ doc: value, extensions }),
      parent: containerRef.current,
    });
    viewRef.current = view;

    return () => {
      view.destroy();
      viewRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      effects: modeCompartment.current.reconfigure(modeKeymap(acceptMode)),
    });
  }, [acceptMode]);

  // Reconciliar alterações externas de value sem criar loop
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const current = view.state.doc.toString();
    if (current !== value) {
      view.dispatch({
        changes: { from: 0, to: current.length, insert: value },
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  return <div ref={containerRef} className="w-full overflow-hidden" />;
}
