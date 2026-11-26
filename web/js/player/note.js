// The small inline field-note prompt (N). Typing goes to a plain <input>, which
// core/input.js already ignores for gameplay keys; Enter saves, Esc (which input.js
// turns into a blur) or clicking away cancels. Pointer lock is kept so closing the
// prompt never bounces the player into the pause menu.
import { buildNote, cleanNote, NOTE_MAX } from './field.js';

export function createNotePrompt(ctx, player) {
  const { bus, net, state } = ctx;
  const root = document.getElementById('tool-overlay') || document.body;

  const box = document.createElement('form');
  box.className = 'tool-note';
  box.hidden = true;
  box.setAttribute('autocomplete', 'off');
  const label = document.createElement('label');
  label.className = 'tool-note-label';
  label.textContent = 'Field note';
  const input = document.createElement('input');
  input.className = 'tool-note-input';
  input.type = 'text';
  input.maxLength = NOTE_MAX;
  input.placeholder = 'What did you notice? Behaviour, habitat, the weather…';
  input.id = 'tool-note-input';
  label.htmlFor = input.id;
  const help = document.createElement('div');
  help.className = 'tool-note-help';
  help.textContent = 'Enter to jot it down · Enter on an empty line or Esc to cancel';
  box.append(label, input, help);
  root.appendChild(box);

  let open = false;

  function show() {
    if (open || state.mode !== 'play') return;
    open = true;
    player.s.busy = true;
    input.value = '';
    box.hidden = false;
    // Focus after the current keydown finishes so the "n" itself is not typed.
    setTimeout(() => { if (open) input.focus(); }, 0);
  }
  function hide() {
    if (!open) return;
    open = false;
    player.s.busy = false;
    box.hidden = true;
    if (document.activeElement === input) input.blur();
  }

  box.addEventListener('submit', (e) => {
    e.preventDefault();
    const text = cleanNote(input.value);
    if (text) {
      net.send('note', buildNote(text));
      ctx.audio?.uiSound?.('page');
      bus.emit('toast', { kind: 'journal', title: 'Field note added', text, xp: 0, icon: 'journal' });
    }
    hide();
  });
  // core/input.js ignores keys typed into inputs and blurs on Escape, which cancels.
  input.addEventListener('blur', () => hide());

  bus.on('action:note', () => show());
  bus.on('mode', ({ mode }) => { if (mode !== 'play') hide(); });

  return { get open() { return open; }, show, hide };
}
