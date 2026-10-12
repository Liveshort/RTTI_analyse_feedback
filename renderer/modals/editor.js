/**
 * editor.js — Full-screen Typst editor overlay.
 *
 * Opens editor.html in the #editor-frame iframe that covers the entire window.
 * All window.rtti calls are proxied from the iframe via postMessage, since the
 * iframe does not have direct access to the contextBridge API.
 */

let _messageHandler = null;

export async function openEditor(opdracht) {
  const overlay = document.getElementById('editor-overlay');
  const frame = document.getElementById('editor-frame');

  // Read the current user badge state from the topbar so the editor can mirror it
  const badgeBtn = document.getElementById('user-badge-btn');
  const badgeInitials = badgeBtn?.textContent?.trim() ?? '?';
  const badgeColor = badgeBtn?.style?.getPropertyValue('--badge-color') ?? '#888';
  const badgeShape = badgeBtn?.classList?.contains('badge-square') ? 'square' : 'circle';

  const params = new URLSearchParams({
    id: opdracht.id,
    typFile: opdracht.typFile,
    naam: opdracht.naam,
    badgeInitials,
    badgeColor,
    badgeShape,
  });
  frame.src = `editor.html?${params}`;
  overlay.classList.remove('hidden');

  // Remove any previous listener before adding a new one
  if (_messageHandler) {
    window.removeEventListener('message', _messageHandler);
  }
  _messageHandler = (evt) => handleEditorMessage(evt, frame);
  window.addEventListener('message', _messageHandler);
}

function closeEditor() {
  const overlay = document.getElementById('editor-overlay');
  const frame = document.getElementById('editor-frame');
  frame.src = '';
  overlay.classList.add('hidden');
  if (_messageHandler) {
    window.removeEventListener('message', _messageHandler);
    _messageHandler = null;
  }
}

function handleEditorMessage(evt, frame) {
  // Only accept messages from our editor frame
  if (evt.source !== frame.contentWindow) return;

  const { type, id, ...rest } = evt.data;

  function reply(result) {
    frame.contentWindow.postMessage({ type: 'rtti-response', id, result }, '*');
  }

  switch (type) {
    case 'rtti-read-text':
      window.rtti.readTextFile(rest.path).then(reply);
      break;
    case 'rtti-write-text':
      window.rtti.writeTextFile(rest.path, rest.content).then(reply);
      break;
    case 'rtti-render-assignment':
      window.rtti.renderAssignmentPdf(rest.typFile, rest.title).then(reply);
      break;
    case 'rtti-render-assignment-svg':
      window.rtti.renderAssignmentSvg(rest.typFile, rest.title, rest.content).then(reply);
      break;
    case 'rtti-list-images':
      window.rtti.listOpdrachtImages(rest.opdrachtId).then(reply);
      break;
    case 'rtti-save-image':
      window.rtti
        .saveOpdrachtImage(rest.opdrachtId, rest.name, rest.ext, rest.base64, rest.overwrite)
        .then(reply);
      break;
    case 'rtti-pick-image':
      window.rtti.pickImageFile().then(reply);
      break;
    case 'rtti-import-image':
      window.rtti
        .importOpdrachtImage(rest.opdrachtId, rest.token, rest.name, rest.overwrite)
        .then(reply);
      break;
    case 'rtti-clipboard-image':
      window.rtti.readClipboardImage().then(reply);
      break;
    case 'rtti-get-data-dir':
      window.rtti.getDataDir().then(reply);
      break;
    case 'editor-close':
      closeEditor();
      break;
    case 'editor-logout':
      closeEditor();
      document.getElementById('user-badge-btn').click();
      break;
    default:
      break;
  }
}
