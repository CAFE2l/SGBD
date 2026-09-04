"use client";

import { useEffect, useRef } from "react";
import { EditorView, keymap, placeholder } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { sql, type SQLNamespace } from "@codemirror/lang-sql";
import { closeCompletion } from "@codemirror/autocomplete";
import { oneDark } from "@codemirror/theme-one-dark";

interface SqlEditorProps {
  value: string;
  onChange: (value: string) => void;
  onRun?: () => void;
  placeholderText?: string;
  schema?: SQLNamespace;
}

const baseTheme = EditorView.theme({
  "&": {
    backgroundColor: "rgba(255,255,255,0.03)",
    borderRadius: "0.75rem",
    fontSize: "13px",
  },
  ".cm-content": { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none" },
});

export function SqlEditor({
  value,
  onChange,
  onRun,
  placeholderText,
  schema = {},
}: SqlEditorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const schemaRef = useRef(schema);
  const schemaCompartment = useRef(new Compartment());
  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  schemaRef.current = schema;

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
      basicSetup,
      schemaCompartment.current.of(sql({ schema: schemaRef.current })),
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
      effects: schemaCompartment.current.reconfigure(
        sql({ schema })
      ),
    });
  }, [schema]);

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
