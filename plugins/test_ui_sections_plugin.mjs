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
      body.replaceChildren();

      let dynamicEnabled = true;
      let clickCount = 0;
      let disposeDynamicBody = () => {};
      let disposeDynamicToggle = () => {};

      const updateDynamicBody = (container, statusEl) => {
        disposeDynamicBody();
        container.replaceChildren();
        if (!dynamicEnabled) {
          statusEl.textContent = 'dynamic body disabled';
          disposeDynamicBody = () => {};
          return;
        }
        const cleanups = [];
        ['Alpha', 'Beta'].forEach((labelText, index) => {
          const { row, field } = host.ui.kit.namedRow(`dynamic ${index}`);
          const button = host.ui.kit.button({
            label: labelText,
            variant: 'pill',
            testId: `plugin.test_ui_dynamic.item.${index}`,
          });
          const onClick = () => {
            clickCount += 1;
            statusEl.textContent = `dynamic click ${index}:${clickCount}`;
          };
          button.addEventListener('click', onClick);
          cleanups.push(() => button.removeEventListener('click', onClick));
          field.appendChild(button);
          container.appendChild(row);
        });
        statusEl.textContent = `dynamic body enabled (${cleanups.length})`;
        disposeDynamicBody = () => {
          for (const cleanup of cleanups) cleanup();
          container.replaceChildren();
          disposeDynamicBody = () => {};
        };
      };

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
        const { row, field } = host.ui.kit.namedRow('dynamic');
        const toggle = host.ui.kit.button({
          label: 'Disable dynamic body',
          variant: 'pill',
          testId: 'plugin.test_ui_dynamic.toggle',
        });
        const onToggle = () => {
          dynamicEnabled = !dynamicEnabled;
          toggle.textContent = dynamicEnabled ? 'Disable dynamic body' : 'Enable dynamic body';
          updateDynamicBody(dynamicBody, dynamicStatus);
        };
        toggle.addEventListener('click', onToggle);
        disposeDynamicToggle = () => toggle.removeEventListener('click', onToggle);
        field.appendChild(toggle);
        body.appendChild(row);
      }

      const dynamicStatus = document.createElement('div');
      dynamicStatus.className = 'plugin-card';
      dynamicStatus.setAttribute('data-testid', 'plugin.test_ui_dynamic.status');
      body.appendChild(dynamicStatus);

      const dynamicBody = document.createElement('div');
      dynamicBody.setAttribute('data-testid', 'plugin.test_ui_dynamic.body');
      body.appendChild(dynamicBody);
      updateDynamicBody(dynamicBody, dynamicStatus);

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

      return () => {
        disposeDynamicToggle();
        disposeDynamicBody();
        body.replaceChildren();
      };
    },
  });

  return () => {
    handle?.dispose?.();
  };
}
