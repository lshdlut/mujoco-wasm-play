export function registerPlayPlugin(host) {
  if (!host?.ui?.sections?.register) {
    throw new Error('host.ui.sections.register unavailable');
  }

  const handle = host.ui.sections.register({
    panel: 'left',
    sectionId: 'plugin:test_ui_sections',
    title: 'Plugin UI Sections',
    defaultOpen: true,
    after: 'file',
    render: (body) => {
      body.innerHTML = '';

      {
        const { row, field } = host.ui.kit.fullRow();
        const btn = host.ui.kit.button({
          label: 'Hello from plugin',
          variant: 'pill',
          testId: 'plugin.test_ui_sections.hello',
          onClick: () => {
            const card = document.createElement('div');
            card.className = 'plugin-card';
            card.textContent = 'clicked';
            body.appendChild(card);
          },
        });
        field.appendChild(btn);
        body.appendChild(row);
      }

      {
        const { row, field } = host.ui.kit.namedRow('select');
        const sel = host.ui.kit.select({
          value: 'b',
          options: ['a', 'b', 'c'],
          testId: 'plugin.test_ui_kit.select',
        });
        field.appendChild(sel);
        body.appendChild(row);
      }

      {
        const { row, field } = host.ui.kit.namedRow('segmented', { full: true });
        const seg = host.ui.kit.segmented({
          options: [
            { value: '0', label: 'keep' },
            { value: '1', label: 'reset' },
          ],
          value: '0',
          testId: 'plugin.test_ui_kit.segmented',
        });
        field.appendChild(seg.root);
        body.appendChild(row);
      }

      {
        const { row, field } = host.ui.kit.fullRow();
        const ta = host.ui.kit.textarea({
          placeholder: 'code textarea',
          rows: 5,
          variant: 'code',
          testId: 'plugin.test_ui_kit.textarea',
        });
        field.appendChild(ta);
        body.appendChild(row);
      }

      {
        const { row, field } = host.ui.kit.fullRow();
        const pre = host.ui.kit.codebox({
          value: 'codebox',
          testId: 'plugin.test_ui_kit.codebox',
        });
        field.appendChild(pre);
        body.appendChild(row);
      }
    },
  });

  return () => {
    handle?.dispose?.();
  };
}
