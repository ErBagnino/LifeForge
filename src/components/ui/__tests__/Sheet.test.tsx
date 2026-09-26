// @vitest-environment jsdom
import { act, fireEvent, render } from '@testing-library/react';
import { useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Sheet } from '../Sheet';

function Harness() {
  const [text, setText] = useState('');
  // Inline onClose on purpose: it changes on every render, like most real callers.
  return (
    <Sheet open onClose={() => setText('')} title="Test">
      <input aria-label="field" value={text} onChange={(e) => setText(e.target.value)} />
    </Sheet>
  );
}

describe('Sheet', () => {
  afterEach(() => vi.useRealTimers());

  it('keeps focus in a field while typing (regression: the keyboard closed after every letter on iOS)', () => {
    vi.useFakeTimers();
    const { getByLabelText } = render(<Harness />);
    act(() => vi.advanceTimersByTime(100)); // initial focus-into-dialog
    const field = getByLabelText('field') as HTMLInputElement;
    field.focus();
    for (const ch of 'Ciao coach') {
      fireEvent.change(field, { target: { value: field.value + ch } });
      act(() => vi.advanceTimersByTime(100));
      expect(document.activeElement).toBe(field);
    }
    expect(field.value).toBe('Ciao coach');
  });
});
