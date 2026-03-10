// File/model UI helpers extracted from control_manager.
// Keep behaviour identical; do not swallow errors.

import { logError, strictCatch, withCacheBust } from '../core/viewer_runtime.mjs';
import { buildMuJoCoBundle as buildMuJoCoBundleCore, normaliseMuJoCoVirtualPath, parseMuJoCoDirectFileRefs } from '../core/xml_refs.mjs';
import { resetModelFrontendState } from './state.mjs';

export function createFileSectionManager({
  store,
  backend,
  pushToast = null,
  devRootUrl,
} = {}) {
  const DEV_ROOT_URL = devRootUrl;

  function createControlRow(control, options = {}) {
    const row = document.createElement('div');
    row.className = 'control-row';
    if (options.full) row.classList.add('full');
    if (options.half) row.classList.add('half');
    if (control?.item_id) {
      row.dataset.controlId = control.item_id;
    }
    return row;
  }

  function createFullRow(options = {}) {
    const row = createControlRow(null, { ...options, full: true });
    const field = document.createElement('div');
    field.className = 'control-field';
    row.append(field);
    return { row, field };
  }

    const modelLibrary = [];
    let lastModelFolderHandle = null;
    let lastModelXmlFileHandle = null;
    let modelSelectEl = null;
    const refreshModelSelectOptions = () => {
      if (!modelSelectEl) return;
      modelSelectEl.innerHTML = '';
      if (modelLibrary.length === 0) {
        const placeholder = document.createElement('option');
        placeholder.value = '';
        placeholder.textContent = 'No models loaded';
        placeholder.disabled = true;
        placeholder.selected = true;
        modelSelectEl.appendChild(placeholder);
        modelSelectEl.disabled = true;
        return;
      }
      modelSelectEl.disabled = false;
      for (let i = 0; i < modelLibrary.length; i += 1) {
        const entry = modelLibrary[i];
        const opt = document.createElement('option');
        opt.value = entry.id;
        opt.textContent = entry.label || `Model ${i + 1}`;
        modelSelectEl.appendChild(opt);
      }
    };

    const addModelEntry = (entry, options = null) => {
      const select = options?.select !== false;
      const existingIndex = modelLibrary.findIndex((item) => item.id === entry.id);
      if (existingIndex >= 0) {
        modelLibrary[existingIndex] = entry;
      } else {
        modelLibrary.push(entry);
      }
      refreshModelSelectOptions();
      if (select && modelSelectEl && entry.id) {
        modelSelectEl.value = entry.id;
      }
      const label = entry.label || entry.file || entry.id || '';
      if (select && label) {
        store.update((draft) => {
          if (!draft.shell) draft.shell = {};
          draft.shell.modelLabel = label;
        });
      }
    };

    async function loadXmlTextAsModel(xmlText, label, options = null) {
      const text = typeof xmlText === 'string' ? xmlText : '';
      const name = typeof label === 'string' && label.trim().length ? label.trim() : `Model ${modelLibrary.length + 1}`;
      if (!text.trim()) {
        throw new Error('loadXmlTextAsModel: empty xml text');
      }
      const entry = {
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        label: name,
        kind: 'xmlText',
        xmlText: text,
      };
      if (options?.source && typeof options.source === 'object') {
        entry.source = options.source;
      }
      addModelEntry(entry);
      resetModelFrontendState(store);
      if (options?.bundle && typeof backend?.loadXmlBundle === 'function') {
        await backend.loadXmlBundle(options.bundle);
        pushToast?.(`Loaded model: ${name}`);
        return;
      }
      if (typeof backend?.loadXmlText === 'function') {
        await backend.loadXmlText(text);
        pushToast?.(`Loaded model: ${name}`);
      }
    }

    function deriveXmlFileName(label) {
      const raw = typeof label === 'string' ? label.trim() : '';
      if (!raw) return '';
      const token = raw.replaceAll('\\', '/');
      const idx = token.lastIndexOf('/');
      return idx >= 0 ? token.slice(idx + 1) : token;
    }

    async function pickDirectoryHandle() {
      if (typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function') {
        const options = { mode: 'read' };
        if (lastModelXmlFileHandle) {
          options.startIn = lastModelXmlFileHandle;
        } else if (lastModelFolderHandle) {
          options.startIn = lastModelFolderHandle;
        }
        return window.showDirectoryPicker(options);
      }
      throw new Error('Directory picker unavailable (requires File System Access API)');
    }

    async function promptDirectoryHandleForXmlRefs(xmlName, refCount, samplePaths = null) {
      const name = String(xmlName || '').trim();
      const count = Number.isFinite(refCount) ? refCount : null;
      if (!name) throw new Error('promptDirectoryHandleForXmlRefs: missing xmlName');

      const doc = typeof document !== 'undefined' ? document : null;
      if (!doc?.body) {
        // No DOM available; fall back to the raw picker (may still be blocked by user-activation rules).
        return pickDirectoryHandle();
      }

      const sampleList = Array.isArray(samplePaths)
        ? samplePaths.map((p) => String(p ?? '').trim()).filter((p) => p.length)
        : [];

      const folderHint = (() => {
        let maxUp = 0;
        const expected = new Set();
        for (const rawPath of sampleList) {
          let token = rawPath.replaceAll('\\', '/');
          let up = 0;
          while (token === '..' || token.startsWith('../')) {
            up += 1;
            token = token === '..' ? '' : token.slice(3);
          }
          if (up > maxUp) maxUp = up;
          const first = token.split('/').filter(Boolean)[0];
          if (first) expected.add(first);
        }

        if (maxUp <= 0) {
          return { message: 'Pick the folder that contains this XML and its referenced files.' };
        }

        const level = maxUp === 1 ? '1 level' : `${maxUp} levels`;
        const expectedHint = expected.size
          ? ` (should contain: ${Array.from(expected).slice(0, 3).join(', ')}${expected.size > 3 ? ` +${expected.size - 3} more` : ''})`
          : '';
        return { message: `Pick a folder ${level} higher${expectedHint}.` };
      })();
      const examplePath = sampleList.find((p) => p === '..' || p.startsWith('../')) || sampleList[0] || '';

      // File System Access pickers must be invoked from a user gesture. The file input `change` handler
      // awaits `file.text()`, which can consume the transient activation. We therefore prompt with a
      // dedicated button so `showDirectoryPicker()` runs on a click.
      return new Promise((resolve, reject) => {
        const backdrop = doc.createElement('div');
        backdrop.style.position = 'fixed';
        backdrop.style.inset = '0';
        backdrop.style.zIndex = '9999';
        backdrop.style.display = 'flex';
        backdrop.style.alignItems = 'center';
        backdrop.style.justifyContent = 'center';
        backdrop.style.padding = '16px';
        backdrop.style.background = 'rgba(0, 0, 0, 0.45)';

        const card = doc.createElement('div');
        card.className = 'overlay-card visible';
        card.style.minWidth = 'min(520px, calc(100vw - 32px))';
        card.style.pointerEvents = 'auto';

        const title = doc.createElement('div');
        title.className = 'help-title';
        title.textContent = 'Folder access required';

        const subtitle = doc.createElement('div');
        subtitle.className = 'help-subtitle';
        subtitle.textContent = 'Select a folder so the viewer can read referenced files.';

        const grid = doc.createElement('div');
        grid.className = 'help-grid';
        const addRow = (key, value) => {
          const keyEl = doc.createElement('div');
          keyEl.className = 'help-key';
          keyEl.textContent = key;
          const valueEl = doc.createElement('div');
          valueEl.className = 'help-desc';
          valueEl.textContent = value;
          grid.append(keyEl, valueEl);
        };

        addRow('XML', name);
        if (count != null) addRow('Refs', String(count));
        if (examplePath) addRow('Example', examplePath);
        addRow('Pick', folderHint.message);

        const footnote = doc.createElement('div');
        footnote.className = 'help-subtitle help-subtitle-unimplemented';
        footnote.textContent = 'Local-only: reads referenced files from your selected folder (no upload).';

        const actions = doc.createElement('div');
        actions.style.display = 'flex';
        actions.style.gap = '10px';
        actions.style.marginTop = '12px';

        const ok = doc.createElement('button');
        ok.type = 'button';
        ok.className = 'btn-primary';
        ok.textContent = 'Select folder';

        const cancel = doc.createElement('button');
        cancel.type = 'button';
        cancel.className = 'btn-secondary';
        cancel.textContent = 'Cancel';

        const cleanup = () => {
          ok.replaceWith(ok.cloneNode(true));
          cancel.replaceWith(cancel.cloneNode(true));
          backdrop.remove();
        };

        const resolveCancel = () => {
          cleanup();
          resolve(null);
        };

        backdrop.addEventListener('click', (ev) => {
          if (ev.target === backdrop) resolveCancel();
        });
        cancel.addEventListener('click', resolveCancel);
        ok.addEventListener('click', async () => {
          ok.disabled = true;
          cancel.disabled = true;
          try {
            const handle = await pickDirectoryHandle();
            lastModelXmlFileHandle = null;
            cleanup();
            resolve(handle);
          } catch (err) {
            cleanup();
            // User canceled the picker.
            if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) {
              lastModelXmlFileHandle = null;
              resolve(null);
              return;
            }
            strictCatch(err, 'main:pickDirectoryHandle', { allow: true });
            reject(err);
          }
        });

        actions.append(ok, cancel);
        card.append(title, subtitle, grid, footnote, actions);
        backdrop.append(card);
        doc.body.append(backdrop);
        ok.focus();
      });
    }

    async function findFirstFileByName(dirHandle, fileName, prefix = '', expectedSize = null) {
      if (!dirHandle || typeof dirHandle.entries !== 'function') return null;
      const target = String(fileName || '');
      if (!target) return null;
      const size = Number.isFinite(expectedSize) ? expectedSize : null;
      let fallback = null;
      try {
        // Enumerating handles is cheap (metadata only) and requires no extra permissions once the root is granted.
        for await (const [name, handle] of dirHandle.entries()) {
          if (!handle) continue;
          const rel = prefix ? `${prefix}/${name}` : name;
          if (handle.kind === 'file') {
            if (name === target) {
              if (size == null) return { handle, relPath: rel, sizeMatch: false };
              const file = await handle.getFile();
              if (file.size === size) return { handle, relPath: rel, sizeMatch: true };
              if (!fallback) fallback = { handle, relPath: rel, sizeMatch: false };
            }
            continue;
          }
          if (handle.kind === 'directory') {
            const found = await findFirstFileByName(handle, target, rel, size);
            if (found?.sizeMatch) return found;
            if (found && !fallback) fallback = found;
          }
        }
      } catch (err) {
        strictCatch(err, 'main:findFirstFileByName');
        throw err;
      }
      return fallback;
    }

    async function getFileHandleByRelPath(rootHandle, relPath) {
      const rel = normaliseMuJoCoVirtualPath(relPath);
      if (!rel) throw new Error('Missing relPath');
      const parts = rel.split('/').filter(Boolean);
      let cur = rootHandle;
      for (let i = 0; i < parts.length; i += 1) {
        const part = parts[i];
        if (i === parts.length - 1) {
          return cur.getFileHandle(part, { create: false });
        }
        cur = await cur.getDirectoryHandle(part, { create: false });
      }
      throw new Error(`Invalid relPath: ${relPath}`);
    }

    async function readDirectoryFileArrayBuffer(rootHandle, relPath) {
      const fileHandle = await getFileHandleByRelPath(rootHandle, relPath);
      const file = await fileHandle.getFile();
      return file.arrayBuffer();
    }

    async function buildMuJoCoBundle(xmlRel, xmlText, readFileArrayBuffer) {
      try {
        return await buildMuJoCoBundleCore(xmlRel, xmlText, readFileArrayBuffer);
      } catch (err) {
        strictCatch(err, 'main:buildMuJoCoBundle', { xmlRel });
        throw err;
      }
    }

    async function readUrlFileArrayBuffer(baseUrl, relPath) {
      const rel = normaliseMuJoCoVirtualPath(relPath);
      if (!rel) throw new Error('Missing relPath');
      const url = new URL(rel, baseUrl);
      const res = await fetch(withCacheBust(url.href));
      if (!res.ok) {
        throw new Error(`Failed to fetch ${rel} (${res.status})`);
      }
      return res.arrayBuffer();
    }

    async function loadXmlTextWithFolderRefs(xmlText, label, expectedSize = null) {
      const text = typeof xmlText === 'string' ? xmlText : '';
      if (!text.trim()) throw new Error('loadXmlTextWithFolderRefs: empty xml text');

      const rootParsed = parseMuJoCoDirectFileRefs(text);
      const rootLocal = (rootParsed.refs ?? []).filter((r) => r && r.path && !r.remote && !r.absolute);
      const rootUnsupported = (rootParsed.refs ?? []).filter((r) => r && r.path && (r.remote || r.absolute));
      if (rootUnsupported.length) {
        const items = rootUnsupported.map((r) => r.path).filter(Boolean).slice(0, 3);
        const suffix = rootUnsupported.length > 3 ? ` (+${rootUnsupported.length - 3} more)` : '';
        throw new Error(`Unsupported file reference(s): ${items.join(', ')}${suffix}`);
      }

      if (!rootLocal.length) {
        await loadXmlTextAsModel(text, label);
        return;
      }

      const xmlName = deriveXmlFileName(label);
      if (!xmlName) {
        throw new Error('Missing xml file name for folder-based load');
      }

      const refPaths = rootLocal.map((r) => r.path).filter(Boolean);
      const root = await promptDirectoryHandleForXmlRefs(xmlName, rootLocal.length, refPaths);
      if (!root) {
        pushToast?.('Folder selection canceled');
        return;
      }
      lastModelFolderHandle = root;
      const found = await findFirstFileByName(root, xmlName, '', expectedSize);
      if (!found?.relPath) {
        throw new Error(`Unable to locate ${xmlName} inside the selected folder`);
      }

      const bundle = await buildMuJoCoBundle(
        found.relPath,
        text,
        async (relPath) => readDirectoryFileArrayBuffer(root, relPath),
      );

      await loadXmlTextAsModel(text, label, {
        bundle: {
          xmlText: text,
          xmlPath: `/mem/${bundle.xmlRel}`,
          files: bundle.files,
        },
        source: {
          kind: 'folder',
          rootHandle: root,
          xmlRel: found.relPath,
        },
      });
    }

    async function loadXmlTextWithUrlRefs(xmlText, xmlRelPath, label) {
      const text = typeof xmlText === 'string' ? xmlText : '';
      if (!text.trim()) throw new Error('loadXmlTextWithUrlRefs: empty xml text');
      const rel = normaliseMuJoCoVirtualPath(xmlRelPath);
      if (!rel) throw new Error('loadXmlTextWithUrlRefs: missing xmlRelPath');

      const rootParsed = parseMuJoCoDirectFileRefs(text);
      const rootLocal = (rootParsed.refs ?? []).filter((r) => r && r.path && !r.remote && !r.absolute);
      const rootUnsupported = (rootParsed.refs ?? []).filter((r) => r && r.path && (r.remote || r.absolute));
      if (rootUnsupported.length) {
        const items = rootUnsupported.map((r) => r.path).filter(Boolean).slice(0, 3);
        const suffix = rootUnsupported.length > 3 ? ` (+${rootUnsupported.length - 3} more)` : '';
        throw new Error(`Unsupported file reference(s): ${items.join(', ')}${suffix}`);
      }

      if (!rootLocal.length) {
        resetModelFrontendState(store);
        if (typeof backend?.loadXmlText === 'function') {
          await backend.loadXmlText(text);
          pushToast?.(`Loaded model: ${label || rel}`);
        }
        return;
      }

      const devRootUrl = DEV_ROOT_URL;
      const bundle = await buildMuJoCoBundle(
        rel,
        text,
        async (refRel) => readUrlFileArrayBuffer(devRootUrl, refRel),
      );
      resetModelFrontendState(store);
      if (typeof backend?.loadXmlBundle === 'function') {
        await backend.loadXmlBundle({
          xmlText: text,
          xmlPath: `/mem/${bundle.xmlRel}`,
          files: bundle.files,
        });
        pushToast?.(`Loaded model: ${label || rel}`);
      } else if (typeof backend?.loadXmlText === 'function') {
        await backend.loadXmlText(text);
        pushToast?.(`Loaded model: ${label || rel}`);
      }
    }

    function renderFileSectionExtras(body) {
      const row = createControlRow(null);

      const loadLabel = document.createElement('label');
      loadLabel.className = 'btn-primary btn-file';
      loadLabel.textContent = 'Load xml';
      loadLabel.setAttribute('data-testid', 'file.load_xml_custom');

      const loadInput = document.createElement('input');
      loadInput.type = 'file';
      loadInput.accept = '.xml';
      loadInput.setAttribute('data-testid', 'file.load_xml_input');
      loadLabel.appendChild(loadInput);

      const field = document.createElement('div');
      field.className = 'control-field';

      const select = document.createElement('select');
      select.setAttribute('data-testid', 'file.model_select');

      field.append(select);
      row.append(loadLabel, field);
      body.append(row);

      modelSelectEl = select;
      refreshModelSelectOptions();

      const initialInfo = typeof backend?.getInitialModelInfo === 'function'
        ? backend.getInitialModelInfo()
        : null;
      if (initialInfo && initialInfo.file) {
        const file = initialInfo.file;
        const label = initialInfo.label || file;
        const entry = {
          id: `builtin_${file}`,
          label,
          kind: 'builtinUrl',
          file,
        };
        addModelEntry(entry);
      }

      const builtinModels = typeof backend?.getBuiltinModels === 'function'
        ? backend.getBuiltinModels()
        : null;
      if (Array.isArray(builtinModels) && builtinModels.length) {
        for (const model of builtinModels) {
          if (!model?.file) continue;
          const file = String(model.file);
          const id = `builtin_${file}`;
          if (modelLibrary.some((entry) => entry.id === id)) continue;
          const entry = {
            id,
            label: model.label || file,
            kind: 'builtinUrl',
            file,
          };
          addModelEntry(entry, { select: false });
        }
      }

      const loadXmlFileImpl = async (file, fileHandle = null) => {
        if (!file) return;
        try {
          const text = await file.text();
          if (fileHandle) lastModelXmlFileHandle = fileHandle;
          await loadXmlTextWithFolderRefs(text, file.name || null, file.size);
        } finally {
          // Always reset so the same file can be selected again.
          loadInput.value = '';
        }
      };

      loadLabel.addEventListener(
        'click',
        async (event) => {
          if (typeof window === 'undefined' || typeof window.showOpenFilePicker !== 'function') return;
          // Use the File System Access picker when available so we can start the folder picker near the selected XML.
          event.preventDefault();
          event.stopPropagation();
          try {
            const [handle] = await window.showOpenFilePicker({
              multiple: false,
              excludeAcceptAllOption: true,
              types: [
                {
                  description: 'MuJoCo XML',
                  accept: { 'application/xml': ['.xml'], 'text/xml': ['.xml'] },
                },
              ],
            });
            if (!handle) return;
            const file = await handle.getFile();
            await loadXmlFileImpl(file, handle);
          } catch (err) {
            if (err && (err.name === 'AbortError' || err.name === 'NotAllowedError')) return;
            logError('[ui] load xml from file failed', err);
            const message = (err && typeof err.message === 'string' && err.message.trim().length)
              ? err.message.trim()
              : 'Failed to load xml from file';
            pushToast?.(message);
            strictCatch(err, 'main:ui_load_xml_file');
            throw err;
          }
        },
        { capture: true },
      );

      loadInput.addEventListener('change', async () => {
        const file = loadInput.files && loadInput.files[0];
        if (!file) return;
        try {
          await loadXmlFileImpl(file);
        } catch (err) {
          logError('[ui] load xml from file failed', err);
          const message = (err && typeof err.message === 'string' && err.message.trim().length)
            ? err.message.trim()
            : 'Failed to load xml from file';
          pushToast?.(message);
          strictCatch(err, 'main:ui_load_xml_file');
          throw err;
        }
      });

      select.addEventListener('change', async () => {
        const id = select.value;
        if (!id) return;
        const entry = modelLibrary.find((item) => item.id === id);
        if (!entry) return;
        try {
          if (entry.kind === 'xmlText' && entry.xmlText) {
            if (entry.source?.kind === 'folder' && entry.source.rootHandle && entry.source.xmlRel) {
              const bundle = await buildMuJoCoBundle(
                entry.source.xmlRel,
                entry.xmlText,
                async (relPath) => readDirectoryFileArrayBuffer(entry.source.rootHandle, relPath),
              );
              resetModelFrontendState(store);
              if (typeof backend?.loadXmlBundle !== 'function') {
                throw new Error('Folder-based model reload requires backend.loadXmlBundle');
              }
              await backend.loadXmlBundle({
                xmlText: entry.xmlText,
                xmlPath: `/mem/${bundle.xmlRel}`,
                files: bundle.files,
              });
              lastModelFolderHandle = entry.source.rootHandle;
              lastModelXmlFileHandle = null;
              pushToast?.(`Loaded model: ${entry.label || id}`);
              store.update((draft) => {
                if (!draft.shell) draft.shell = {};
                draft.shell.modelLabel = entry.label || entry.id || '';
              });
              return;
            }
            if (entry.file) {
              await loadXmlTextWithUrlRefs(entry.xmlText, entry.file, entry.label || id);
              store.update((draft) => {
                if (!draft.shell) draft.shell = {};
                draft.shell.modelLabel = entry.label || entry.file || entry.id || '';
              });
            } else {
              resetModelFrontendState(store);
              if (typeof backend?.loadXmlText === 'function') {
                await backend.loadXmlText(entry.xmlText);
                pushToast?.(`Loaded model: ${entry.label || id}`);
                store.update((draft) => {
                  if (!draft.shell) draft.shell = {};
                  draft.shell.modelLabel = entry.label || entry.id || '';
                });
              }
            }
            return;
          }
          if (entry.kind === 'builtinUrl' && entry.file) {
            const url = new URL(entry.file, DEV_ROOT_URL);
            const res = await fetch(withCacheBust(url.href));
            if (!res.ok) {
              pushToast?.(`Failed to fetch model: ${entry.label || entry.file}`);
              return;
            }
            const text = await res.text();
            entry.kind = 'xmlText';
            entry.xmlText = text;
            await loadXmlTextWithUrlRefs(text, entry.file, entry.label || id);
            store.update((draft) => {
              if (!draft.shell) draft.shell = {};
              draft.shell.modelLabel = entry.label || entry.file || entry.id || '';
            });
          }
        } catch (err) {
          logError('[ui] model select reload failed', err);
          pushToast?.('Failed to load selected model');
          strictCatch(err, 'main:ui_model_select_reload');
          throw err;
        }
      });

      refreshModelSelectOptions();

      const noteRow = createFullRow();
      noteRow.field.classList.add('control-static');
      noteRow.field.textContent = 'Simulate File actions are disabled here.';
      body.append(noteRow.row);
    }

  return {
    loadXmlTextAsModel,
    renderFileSectionExtras,
  };
}
