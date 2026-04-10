import { useEffect, useRef } from 'react';

interface FileTreeInlineInputProps {
  placeholder: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}

export function FileTreeInlineInput({
  placeholder,
  onConfirm,
  onCancel,
}: FileTreeInlineInputProps) {
  const ref = useRef<HTMLInputElement>(null);

  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);

  const commit = () => {
    const value = ref.current?.value.trim() ?? '';
    if (value) {
      onConfirm(value);
      return;
    }
    onCancel();
  };

  return (
    <input
      ref={ref}
      placeholder={placeholder}
      className="field-shell rounded-xl px-2.5 py-1.5 text-xs"
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') {
          commit();
        }
        if (event.key === 'Escape') {
          onCancel();
        }
      }}
    />
  );
}
