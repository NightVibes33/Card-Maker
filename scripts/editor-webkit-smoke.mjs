import assert from 'node:assert/strict';
import { webkit } from 'playwright';
import sharp from 'sharp';

const baseUrl = process.env.CARD_STUDIO_URL || 'http://127.0.0.1:3000';
const browser = await webkit.launch({ headless: true });
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block',
  acceptDownloads: true
});
await context.addInitScript(() => {
  try {
    localStorage.setItem('aircard-install-dismissed-v2', '1');
  } catch {}
});
const page = await context.newPage();
const pageErrors = [];

page.on('pageerror', (error) => {
  pageErrors.push(String(error?.stack || error?.message || error));
});

// Prevent asynchronous onboarding hydration from racing the first editor tap.
await page.addInitScript(() => {
  try {
    localStorage.setItem('aircard-install-dismissed-v2', '1');
  } catch {}
});

await page.route('**/api/cucu**', async (route) => {
  await route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ results: [], total: 0, hasMore: false })
  });
});

try {
  await page.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('main.studio').waitFor({ state: 'visible', timeout: 15000 });

  const installDialog = page.getByRole('dialog', { name: 'Install Card Studio' });
  if (await installDialog.isVisible().catch(() => false)) {
    await page.getByRole('button', { name: 'Close Install Card Studio' }).click();
    await installDialog.waitFor({ state: 'hidden', timeout: 5000 });
  }

  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Card', exact: true }).click();

  const editorCanvas = page.locator('.cardFrame canvas').first();
  assert.equal(await editorCanvas.getAttribute('width'), '1024');
  assert.equal(await editorCanvas.getAttribute('height'), '646');

  const initialCanvasBox = await editorCanvas.boundingBox();
  assert.ok(initialCanvasBox, 'editor canvas must have a layout box');

  // Built-in card text should be directly selectable from its rendered badge.
  const topBadge = page.getByRole('switch', { name: 'Top Badge' });
  await topBadge.click();
  await editorCanvas.click({
    position: {
      x: initialCanvasBox.width * ((1536 - 105) / 1536),
      y: initialCanvasBox.height * (105 / 969)
    }
  });
  await page.getByRole('button', { name: /Card Text Built-in text selected/i }).waitFor({
    state: 'visible',
    timeout: 5000
  });
  await topBadge.click();

  // Direct chip drag must target the chip rather than nearby contactless art.
  // Card controls above can auto-scroll the page, so remeasure the canvas
  // immediately before any absolute-coordinate pointer gesture.
  await editorCanvas.scrollIntoViewIfNeeded();
  const chipGestureBox = await editorCanvas.boundingBox();
  assert.ok(chipGestureBox, 'chip drag requires a visible editor canvas');

  const chipStartX = 0.105 + (255 / 2) / 1536;
  const chipStartY = 0.35 + (188 / 2) / 969;
  await page.mouse.move(
    chipGestureBox.x + chipGestureBox.width * chipStartX,
    chipGestureBox.y + chipGestureBox.height * chipStartY
  );
  await page.mouse.down();
  await page.mouse.move(
    chipGestureBox.x + chipGestureBox.width * chipStartX + 34,
    chipGestureBox.y + chipGestureBox.height * chipStartY,
    { steps: 4 }
  );
  await page.mouse.up();

  await page.getByRole('tab', { name: 'Position', exact: true }).click();
  const chipX = page.getByLabel('Chip horizontal position');
  await chipX.waitFor({ state: 'visible', timeout: 5000 });
  assert.ok(Number(await chipX.inputValue()) > 0.14, 'direct canvas drag must move the built-in EMV chip');
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Chip horizontal position"]');
    return input && Math.abs(Number(input.value) - 0.105) < 0.001;
  });

  // Contactless overlaps the chip's padded touch region; stack order must
  // still select Contactless at its own center. Remeasure after the Position
  // controls/Undo interaction because those can scroll the sticky editor.
  await editorCanvas.scrollIntoViewIfNeeded();
  const contactlessGestureBox = await editorCanvas.boundingBox();
  assert.ok(contactlessGestureBox, 'contactless drag requires a visible editor canvas');

  await page.mouse.move(
    contactlessGestureBox.x + contactlessGestureBox.width * 0.285,
    contactlessGestureBox.y + contactlessGestureBox.height * 0.43
  );
  await page.mouse.down();
  await page.mouse.move(
    contactlessGestureBox.x + contactlessGestureBox.width * 0.285 + 34,
    contactlessGestureBox.y + contactlessGestureBox.height * 0.43,
    { steps: 4 }
  );
  await page.mouse.up();

  const contactlessX = page.getByLabel('Contactless horizontal position');
  await contactlessX.waitFor({ state: 'visible', timeout: 5000 });
  assert.ok(
    Number(await contactlessX.inputValue()) > 0.32,
    'contactless must win hit testing at its own center and move directly'
  );
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Contactless horizontal position"]');
    return input && Math.abs(Number(input.value) - 0.285) < 0.001;
  });

  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  await page.getByRole('button', { name: '+ Text', exact: true }).click();
  const textEditor = page.getByLabel('Layer text');
  await textEditor.fill('AVATAR\nWA');
  assert.equal(await textEditor.inputValue(), 'AVATAR\nWA');

  await page.getByLabel('Text layer font').selectOption('serif');
  assert.equal(await page.getByLabel('Text layer font').inputValue(), 'serif');

  const rightAlign = page.getByRole('group', { name: 'Text alignment' }).getByRole('button', { name: 'Right' });
  await rightAlign.click();
  assert.equal(await rightAlign.getAttribute('aria-pressed'), 'true');

  const lockLayer = page.getByRole('switch', { name: 'Lock Layer' });
  await lockLayer.click();
  assert.equal(await lockLayer.getAttribute('aria-checked'), 'true');
  assert.equal(await textEditor.isDisabled(), true);
  assert.equal(
    await page.getByRole('button', { name: 'Delete', exact: true }).isDisabled(),
    true,
    'locked layers must disable destructive deletion'
  );
  assert.equal(
    await page.getByRole('button', { name: 'Bring Forward', exact: true }).isDisabled(),
    true,
    'locked layers must disable z-order movement'
  );

  const showLayer = page.getByRole('switch', { name: 'Show Layer' });
  await showLayer.click();
  assert.equal(await showLayer.getAttribute('aria-checked'), 'false');
  assert.ok(
    await page.getByRole('button', { name: /Text text hidden/i }).isVisible(),
    'hidden layers must remain visible in the layer stack so they can be recovered'
  );

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(() => {
    const control = [...document.querySelectorAll('[role="switch"]')]
      .find((node) => node.textContent?.includes('Show Layer'));
    return control?.getAttribute('aria-checked') === 'true';
  });
  assert.equal(await showLayer.getAttribute('aria-checked'), 'true');

  await lockLayer.click();
  assert.equal(await lockLayer.getAttribute('aria-checked'), 'false');
  assert.equal(await textEditor.isDisabled(), false);

  await page.getByRole('button', { name: '+ Shape', exact: true }).click();
  const shapeGroup = page.getByRole('group', { name: 'Shape type' });
  const ellipse = shapeGroup.getByRole('button', { name: 'Ellipse', exact: true });
  const rectangle = shapeGroup.getByRole('button', { name: 'Rectangle', exact: true });

  await ellipse.click();
  assert.equal(await ellipse.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByLabel('Corner Radius').count(), 0);

  await rectangle.click();
  assert.equal(await rectangle.getAttribute('aria-pressed'), 'true');
  assert.equal(await page.getByLabel('Corner Radius').count(), 1);

  const customStackOrder = async () => page.locator('.layerRow').evaluateAll((nodes) =>
    nodes
      .map((node) => node.getAttribute('aria-label') || '')
      .filter((label) => /^(Text text|Shape shape) /i.test(label))
  );
  const initialStack = await customStackOrder();
  assert.ok(
    initialStack.findIndex((label) => /^Text text /i.test(label)) <
      initialStack.findIndex((label) => /^Shape shape /i.test(label)),
    'new shape should begin below the existing text layer'
  );

  await page.getByRole('button', { name: 'Bring Forward', exact: true }).click();
  const forwardedStack = await customStackOrder();
  assert.ok(
    forwardedStack.findIndex((label) => /^Shape shape /i.test(label)) <
      forwardedStack.findIndex((label) => /^Text text /i.test(label)),
    'Bring Forward must move the selected shape above the text layer'
  );

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  const restoredStack = await customStackOrder();
  assert.ok(
    restoredStack.findIndex((label) => /^Text text /i.test(label)) <
      restoredStack.findIndex((label) => /^Shape shape /i.test(label)),
    'Undo must restore the previous layer order'
  );

  await page.getByRole('tab', { name: 'Position', exact: true }).click();
  const layerX = page.getByLabel('Layer horizontal position');
  assert.equal(Number(await layerX.inputValue()), 0.5);

  const canvasBox = await editorCanvas.boundingBox();
  assert.ok(canvasBox, 'editor canvas must have a layout box');
  await page.mouse.move(
    canvasBox.x + canvasBox.width / 2,
    canvasBox.y + canvasBox.height / 2
  );
  await page.mouse.down();
  await page.mouse.move(
    canvasBox.x + canvasBox.width / 2 + 42,
    canvasBox.y + canvasBox.height / 2,
    { steps: 5 }
  );
  await page.mouse.up();

  const movedLayerX = Number(await layerX.inputValue());
  assert.ok(movedLayerX > 0.55, 'direct canvas drag must move the selected shape');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Layer horizontal position"]');
    return input && Math.abs(Number(input.value) - 0.5) < 0.001;
  });
  assert.ok(
    Math.abs(Number(await layerX.inputValue()) - 0.5) < 0.001,
    'Undo must restore the pre-drag shape position'
  );

  // A no-op edit must not clear the redo stack. Switch to Card, choose the
  // already-selected Rectangle type, then require Redo to remain available.
  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  const currentRectangle = page.getByRole('group', { name: 'Shape type' })
    .getByRole('button', { name: 'Rectangle', exact: true });
  assert.equal(await currentRectangle.getAttribute('aria-pressed'), 'true');
  await currentRectangle.click();
  assert.equal(
    await page.getByRole('button', { name: 'Redo', exact: true }).isDisabled(),
    false,
    'a no-op layer edit must preserve redo history'
  );
  await page.getByRole('tab', { name: 'Position', exact: true }).click();

  await page.getByRole('button', { name: 'Redo', exact: true }).click();
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Layer horizontal position"]');
    return input && Number(input.value) > 0.55;
  });
  assert.ok(
    Number(await layerX.inputValue()) > 0.55,
    'Redo must restore the dragged shape position'
  );

  const layerScale = page.getByLabel('Layer Scale');
  const layerRotation = page.getByLabel('Layer Rotation');
  const gestureCenterX = Number(await layerX.inputValue());

  await editorCanvas.evaluate((node, normalizedX) => {
    const rect = node.getBoundingClientRect();
    const cx = rect.left + rect.width * normalizedX;
    const cy = rect.top + rect.height * 0.5;
    const originalSetPointerCapture = node.setPointerCapture;
    node.setPointerCapture = () => {};

    const fire = (type, pointerId, x, y, isPrimary = false) => {
      node.dispatchEvent(new PointerEvent(type, {
        bubbles: true,
        cancelable: true,
        pointerId,
        pointerType: 'touch',
        isPrimary,
        clientX: x,
        clientY: y,
        button: 0,
        buttons: type === 'pointerup' ? 0 : 1
      }));
    };

    try {
      fire('pointerdown', 41, cx - 20, cy, true);
      fire('pointerdown', 42, cx + 20, cy, false);
      fire('pointermove', 41, cx - 38, cy - 18, true);
      fire('pointermove', 42, cx + 38, cy + 18, false);
      fire('pointerup', 42, cx + 38, cy + 18, false);
      fire('pointerup', 41, cx - 38, cy - 18, true);
    } finally {
      node.setPointerCapture = originalSetPointerCapture;
    }
  }, gestureCenterX);

  await page.waitForFunction(() => {
    const scale = document.querySelector('input[aria-label="Layer Scale"]');
    const rotation = document.querySelector('input[aria-label="Layer Rotation"]');
    return scale && rotation && Number(scale.value) > 1.2 && Math.abs(Number(rotation.value)) > 5;
  });
  assert.ok(Number(await layerScale.inputValue()) > 1.2, 'two-finger gesture must scale the selected shape');
  assert.ok(Math.abs(Number(await layerRotation.inputValue())) > 5, 'two-finger gesture must rotate the selected shape');

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(() => {
    const scale = document.querySelector('input[aria-label="Layer Scale"]');
    const rotation = document.querySelector('input[aria-label="Layer Rotation"]');
    return scale && rotation &&
      Math.abs(Number(scale.value) - 1) < 0.001 &&
      Math.abs(Number(rotation.value)) < 0.001;
  });
  assert.ok(
    Math.abs(Number(await layerScale.inputValue()) - 1) < 0.001,
    'Undo must restore pre-gesture scale'
  );
  assert.ok(
    Math.abs(Number(await layerRotation.inputValue())) < 0.001,
    'Undo must restore pre-gesture rotation'
  );

  // Zero is a valid normalized coordinate. Older editor code used x || 0.5
  // and silently snapped an exact zero back to center.
  await layerX.evaluate((node) => {
    node.value = '0';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Layer horizontal position"]');
    return input && Number(input.value) === 0;
  });
  assert.equal(
    Number(await layerX.inputValue()),
    0,
    'an exact zero layer coordinate must remain zero'
  );

  // A duplicate at the right edge must not clamp directly on top of its
  // source. Move the source to x=1, duplicate it, and require an inward
  // offset for the newly selected copy.
  await layerX.evaluate((node) => {
    node.value = '1';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Layer horizontal position"]');
    return input && Number(input.value) === 1;
  });

  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  const duplicateShape = page.getByRole('button', { name: 'Duplicate', exact: true });
  await duplicateShape.click();
  await page.waitForFunction(() => {
    return [...document.querySelectorAll('button')].filter(
      (node) => /^Shape shape /i.test(node.getAttribute('aria-label') || '')
    ).length >= 2;
  });

  await page.getByRole('tab', { name: 'Position', exact: true }).click();
  const duplicateLayerX = page.getByLabel('Layer horizontal position');
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Layer horizontal position"]');
    const value = Number(input?.value);
    return Number.isFinite(value) && value < 1 && value > 0.9;
  });
  assert.ok(
    Number(await duplicateLayerX.inputValue()) < 1,
    'duplicating a layer at x=1 must visibly offset the copy inward'
  );

  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  const deleteShape = page.getByRole('button', { name: 'Delete', exact: true });
  await deleteShape.click();
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction(() => {
    return [...document.querySelectorAll('button')].filter(
      (node) => /^Shape shape /i.test(node.getAttribute('aria-label') || '')
    ).length >= 2;
  });

  await page.getByRole('tab', { name: 'Card', exact: true }).click();

  // Built-in hardware uses a separate transform path from custom layers.
  // Exercise it explicitly so direct-manipulation regressions cannot hide
  // behind the custom shape/image coverage above.
  await page.getByRole('button', { name: /^EMV Chip Built-in hardware /i }).click();
  await page.getByRole('tab', { name: 'Position', exact: true }).click();

  const builtinChipX = page.getByLabel('Chip horizontal position');
  const builtinChipY = page.getByLabel('Chip vertical position');
  const builtinChipScale = page.getByLabel('Chip size');
  const chipXBefore = Number(await builtinChipX.inputValue());
  const chipYBefore = Number(await builtinChipY.inputValue());
  const chipScaleBefore = Number(await builtinChipScale.inputValue());

  const chipCanvasBox = await editorCanvas.boundingBox();
  assert.ok(chipCanvasBox, 'built-in chip test requires a visible editor canvas');

  const chipCenterX =
    chipCanvasBox.x +
    chipCanvasBox.width * (chipXBefore + ((255 * chipScaleBefore) / 2) / 1536);
  const chipCenterY =
    chipCanvasBox.y +
    chipCanvasBox.height * (chipYBefore + ((188 * chipScaleBefore) / 2) / 969);

  await page.mouse.move(chipCenterX, chipCenterY);
  await page.mouse.down();
  await page.mouse.move(chipCenterX + 32, chipCenterY, { steps: 4 });
  await page.mouse.up();

  await page.waitForFunction((before) => {
    const input = document.querySelector('input[aria-label="Chip horizontal position"]');
    return input && Number(input.value) > before;
  }, chipXBefore);
  assert.ok(
    Number(await builtinChipX.inputValue()) > chipXBefore,
    'direct canvas drag must move the built-in EMV chip'
  );

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction((before) => {
    const input = document.querySelector('input[aria-label="Chip horizontal position"]');
    return input && Math.abs(Number(input.value) - before) < 0.002;
  }, chipXBefore);

  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  await page.getByRole('button', { name: /^Contactless Built-in hardware /i }).click();
  await page.getByRole('tab', { name: 'Position', exact: true }).click();

  const contactlessRotation = page.getByLabel('Contactless rotation');
  const contactlessRotationBefore = Number(await contactlessRotation.inputValue());
  await contactlessRotation.evaluate((node) => {
    node.value = '24';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Contactless rotation"]');
    return input && Math.abs(Number(input.value) - 24) < 0.001;
  });
  assert.equal(
    Number(await contactlessRotation.inputValue()),
    24,
    'built-in contactless rotation control must update in WebKit'
  );

  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.waitForFunction((before) => {
    const input = document.querySelector('input[aria-label="Contactless rotation"]');
    return input && Math.abs(Number(input.value) - before) < 0.001;
  }, contactlessRotationBefore);

  await page.getByRole('tab', { name: 'Card', exact: true }).click();

  await page.getByRole('button', { name: '+ Chip', exact: true }).click();
  const customChipFinish = page.getByRole('radiogroup', { name: 'Custom chip finish' });
  await customChipFinish.waitFor({ state: 'visible', timeout: 5000 });
  const silverChip = customChipFinish.getByRole('radio', { name: 'Silver', exact: true });
  await silverChip.click();
  assert.equal(await silverChip.getAttribute('aria-checked'), 'true');

  await page.getByRole('button', { name: '+ Contactless', exact: true }).click();
  await page.getByText('Contactless Color', { exact: true }).waitFor({
    state: 'visible',
    timeout: 5000
  });

  const imageInputs = page.locator('input[type="file"][accept="image/*"]');
  assert.ok(await imageInputs.count() >= 2, 'background and image-layer file inputs must exist');

  const oversizedSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="20000" height="20000"><rect width="100%" height="100%" fill="black"/></svg>'
  );
  await imageInputs.last().setInputFiles({
    name: 'oversized-safe.svg',
    mimeType: 'image/svg+xml',
    buffer: oversizedSvg
  });
  await page.getByText('Image resolution is too large for reliable iPhone editing.', { exact: true }).waitFor({
    state: 'visible',
    timeout: 10000
  });
  assert.equal(
    await page.getByLabel('Image Width').count(),
    0,
    'oversized vector art must be rejected before creating a layer'
  );

  const unsafeSvg = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80"><image href="https://example.com/remote.png" width="120" height="80"/></svg>'
  );
  await imageInputs.last().setInputFiles({
    name: 'unsafe-remote.svg',
    mimeType: 'image/svg+xml',
    buffer: unsafeSvg
  });
  await page.getByText('SVG contains unsupported active or remote content.', { exact: true }).waitFor({
    state: 'visible',
    timeout: 10000
  });
  assert.equal(
    await page.getByLabel('Image Width').count(),
    0,
    'unsafe SVG must not create an image layer'
  );

  const tinyPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR42mNk+M9QzwAEYBxVSFUAAGMABf4C/WQAAAAASUVORK5CYII=',
    'base64'
  );
  await imageInputs.last().setInputFiles({
    name: 'webkit-smoke.png',
    mimeType: 'image/png',
    buffer: tinyPng
  });

  const imageWidth = page.getByLabel('Image Width').first();
  await imageWidth.waitFor({ state: 'visible', timeout: 15000 });
  assert.equal(Number(await imageWidth.inputValue()), 640);

  await page.getByRole('tab', { name: 'Crop', exact: true }).click();
  const layerCropLeft = page.getByLabel('Layer Crop Left');
  await layerCropLeft.waitFor({ state: 'visible', timeout: 15000 });
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Layer Crop Left"]');
    return Boolean(input && !input.disabled);
  }, null, { timeout: 15000 });
  await layerCropLeft.evaluate((node) => {
    node.value = '0.1';
    node.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Layer Crop Left"]');
    return input && Math.abs(Number(input.value) - 0.1) < 0.001;
  });
  assert.ok(
    Math.abs(Number(await layerCropLeft.inputValue()) - 0.1) < 0.001,
    'imported image-layer crop controls must update in WebKit'
  );

  const previewStyle = page.getByRole('group', { name: 'Preview style' });
  await previewStyle.getByRole('button', { name: 'Physical', exact: true }).click();
  assert.equal(await editorCanvas.evaluate((node) => node.style.touchAction), 'pan-y');

  await previewStyle.getByRole('button', { name: 'Flat', exact: true }).click();
  assert.equal(await editorCanvas.evaluate((node) => node.style.touchAction), 'none');

  await page.getByRole('tab', { name: 'Crop', exact: true }).click();
  const [fileChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.getByRole('button', { name: /Replace Artwork/ }).click()
  ]);
  await fileChooser.setFiles({
    name: 'webkit-smoke.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9Z4e0AAAAASUVORK5CYII=',
      'base64'
    )
  });
  await page.getByText('Imported image ready to crop', { exact: true }).waitFor({
    state: 'visible',
    timeout: 15000
  });

  // Let the 420ms autosave commit both the imported-image reference and
  // custom layer state, then verify hydration restores them after a reload.
  await page.waitForTimeout(900);
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.locator('main.studio').waitFor({ state: 'visible', timeout: 15000 });
  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Card', exact: true }).click();

  const restoredTextRow = page.getByRole('button', { name: /^Text text /i }).first();
  await restoredTextRow.waitFor({ state: 'visible', timeout: 10000 });
  await restoredTextRow.click();
  assert.equal(await page.getByLabel('Layer text').inputValue(), 'AVATAR\nWA');

  // Exercise the named-project Library independently of autosave. Save this
  // exact state, mutate the text, then reopen the project and confirm the
  // saved snapshot wins without losing imported-asset references.
  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  await page.getByLabel('Project name').fill('WebKit Project');
  await page.getByRole('button', { name: 'Save Current Design', exact: true }).click();
  const savedProject = page.locator('article.projectCard').filter({ hasText: 'WebKit Project' }).first();
  await savedProject.waitFor({ state: 'visible', timeout: 15000 });

  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  await page.getByRole('button', { name: /^Text text /i }).first().click();
  await page.getByLabel('Layer text').fill('MUTATED');
  assert.equal(await page.getByLabel('Layer text').inputValue(), 'MUTATED');

  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  const savedProjectAgain = page.locator('article.projectCard').filter({ hasText: 'WebKit Project' }).first();
  await savedProjectAgain.getByRole('button', { name: 'Open', exact: true }).click();

  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  await page.getByRole('button', { name: /^Text text /i }).first().click();
  assert.equal(
    await page.getByLabel('Layer text').inputValue(),
    'AVATAR\nWA',
    'opening a named project must restore its saved design snapshot'
  );

  // Round-trip the complete editable preset, including embedded imported
  // background/image assets, through the browser download + file import path.
  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  const [presetDownload] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    page.getByRole('button', { name: /Export Design JSON/ }).click()
  ]);
  assert.match(presetDownload.suggestedFilename(), /\.aircard\.json$/i);
  const presetPath = await presetDownload.path();
  assert.ok(presetPath, 'preset download must produce a local file for round-trip import');

  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  await page.getByRole('button', { name: /^Text text /i }).first().click();
  await page.getByLabel('Layer text').fill('PRESET MUTATED');

  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  const [presetChooser] = await Promise.all([
    page.waitForEvent('filechooser', { timeout: 10000 }),
    page.getByRole('button', { name: /Import Design JSON/ }).click()
  ]);
  await presetChooser.setFiles(presetPath);
  await page.getByText('Design preset imported', { exact: true }).waitFor({
    state: 'visible',
    timeout: 20000
  });

  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  await page.getByRole('button', { name: /^Text text /i }).first().click();
  assert.equal(
    await page.getByLabel('Layer text').inputValue(),
    'AVATAR\nWA',
    'preset import must restore the exported text-layer state'
  );

  // New Card is destructive-looking UI but must remain one-step undoable.
  await page.getByRole('button', { name: /New Card/ }).click();
  await page.getByText('New card · Undo is available', { exact: true }).waitFor({
    state: 'visible',
    timeout: 5000
  });
  await page.getByRole('button', { name: 'Undo', exact: true }).click();
  await page.getByRole('tab', { name: 'Card', exact: true }).click();
  await page.getByRole('button', { name: /^Text text /i }).first().click();
  assert.equal(
    await page.getByLabel('Layer text').inputValue(),
    'AVATAR\nWA',
    'Undo after New Card must restore the previous complete design'
  );

  // Verify signed Expert Mode values on mobile WebKit. iPhone numeric
  // keyboards historically made negative values impossible to enter.
  await page.getByRole('tab', { name: 'Library', exact: true }).click();
  const expertMode = page.getByRole('switch', { name: 'Expert Mode' });
  if ((await expertMode.getAttribute('aria-checked')) !== 'true') {
    await expertMode.click();
  }
  await page.getByRole('tab', { name: 'Studio', exact: true }).click();
  await page.getByRole('tab', { name: 'Position', exact: true }).click();

  const exactArtworkX = page.getByLabel('Artwork X');
  await exactArtworkX.fill('-0.25');
  await exactArtworkX.blur();
  await page.waitForFunction(() => {
    const input = document.querySelector('input[aria-label="Artwork X"]');
    return input && Math.abs(Number(input.value) + 0.25) < 0.001;
  });
  assert.ok(
    Math.abs(Number(await exactArtworkX.inputValue()) + 0.25) < 0.001,
    'signed Expert Mode coordinates must accept negative values in WebKit'
  );

  await exactArtworkX.fill('0');
  await exactArtworkX.blur();

  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  const save2x = page.getByRole('button', { name: /Save 2× Image/ }).first();
  await save2x.waitFor({ state: 'visible' });
  await page.waitForFunction(() => {
    const button = [...document.querySelectorAll('button')]
      .find((node) => node.textContent?.includes('Save 2× Image'));
    return button && !button.disabled;
  }, null, { timeout: 15000 });
  assert.equal(await save2x.isDisabled(), false);

  const [download] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    save2x.click()
  ]);
  assert.equal(download.suggestedFilename(), 'cardBackgroundCombined@2x.png');

  const downloadPath = await download.path();
  assert.ok(downloadPath, 'exported PNG must have a local download path');
  const exportMeta = await sharp(downloadPath).metadata();
  assert.equal(exportMeta.format, 'png');
  assert.equal(exportMeta.width, 1024);
  assert.equal(exportMeta.height, 646);

  const save3x = page.getByRole('button', { name: /Save 3× Image/ }).first();
  await save3x.waitFor({ state: 'visible' });
  assert.equal(await save3x.isDisabled(), false);

  const [download3x] = await Promise.all([
    page.waitForEvent('download', { timeout: 20000 }),
    save3x.click()
  ]);
  assert.equal(download3x.suggestedFilename(), 'cardBackgroundCombined@3x.png');

  const download3xPath = await download3x.path();
  assert.ok(download3xPath, '3× exported PNG must have a local download path');
  const export3xMeta = await sharp(download3xPath).metadata();
  assert.equal(export3xMeta.format, 'png');
  assert.equal(export3xMeta.width, 1536);
  assert.equal(export3xMeta.height, 969);

  if (pageErrors.length) {
    throw new Error('Page errors:\n' + pageErrors.join('\n\n'));
  }

  console.log('PASS mobile WebKit editor smoke');
} finally {
  await context.close();
}

const corruptContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'block'
});
await corruptContext.addInitScript(() => {
  try {
    localStorage.setItem('aircard-install-dismissed-v2', '1');
  } catch {}
});
const corruptPage = await corruptContext.newPage();
const corruptErrors = [];
corruptPage.on('pageerror', (error) => {
  corruptErrors.push(String(error?.stack || error?.message || error));
});

try {
  await corruptPage.route('**/api/cucu**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [], total: 0, hasMore: false })
    });
  });

  await corruptPage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await corruptPage.locator('main.studio').waitFor({ state: 'visible', timeout: 15000 });

  await corruptPage.evaluate(async () => {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open('aircard-studio-v2', 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error('IndexedDB open failed'));
    });

    await new Promise((resolve, reject) => {
      const tx = db.transaction(['favorites', 'projects', 'importMeta', 'exports'], 'readwrite');
      tx.objectStore('favorites').put({
        id: 'corrupt-favorite',
        item: { id: 'bad-favorite', title: { bad: true }, image: 'javascript:alert(1)' },
        updatedAt: 'not-a-number'
      });
      tx.objectStore('projects').put({
        id: 'corrupt-project',
        name: { bad: true },
        design: {
          gradient: 'bad',
          customLayers: 'not-an-array',
          layerOrder: 'not-an-array'
        },
        preview: 'javascript:not-an-image',
        createdAt: 'not-a-number',
        updatedAt: 'not-a-number'
      });
      tx.objectStore('importMeta').put({
        id: 'stale-import-meta',
        name: { bad: true },
        type: { bad: true },
        createdAt: 'not-a-number'
      });
      tx.objectStore('exports').put({
        id: 'corrupt-export',
        name: { bad: true },
        designName: { bad: true },
        action: { bad: true },
        width: 'not-a-number',
        height: 'not-a-number',
        createdAt: 'not-a-number'
      });
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error || new Error('IndexedDB seed failed'));
      tx.onabort = () => reject(tx.error || new Error('IndexedDB seed aborted'));
    });
  });

  await corruptPage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await corruptPage.locator('main.studio').waitFor({ state: 'visible', timeout: 15000 });
  await corruptPage.getByRole('tab', { name: 'Library', exact: true }).click();

  const libraryText = await corruptPage.locator('#panel-library').innerText();
  assert.ok(!/NaN|Invalid Date/i.test(libraryText), 'corrupt numeric metadata must normalize before Library rendering');
  assert.equal(
    await corruptPage.locator('img[src^="javascript:"]').count(),
    0,
    'corrupt stored previews/artwork must never become executable image sources'
  );
  assert.equal(corruptErrors.length, 0, 'corrupt local rows must not cause page errors');

  console.log('PASS mobile WebKit corrupt-local-storage recovery');
} finally {
  await corruptContext.close();
}

const offlineContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 3,
  isMobile: true,
  hasTouch: true,
  serviceWorkers: 'allow'
});
await offlineContext.addInitScript(() => {
  try {
    localStorage.setItem('aircard-install-dismissed-v2', '1');
  } catch {}
});
const offlinePage = await offlineContext.newPage();

try {
  await offlinePage.route('**/api/cucu**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ results: [], total: 0, hasMore: false })
    });
  });

  await offlinePage.goto(baseUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await offlinePage.locator('main.studio').waitFor({ state: 'visible', timeout: 15000 });
  await offlinePage.evaluate(async () => {
    if (!('serviceWorker' in navigator)) throw new Error('Service workers unavailable');
    await navigator.serviceWorker.ready;
  });
  await offlinePage.waitForFunction(() => Boolean(navigator.serviceWorker?.controller), null, {
    timeout: 15000
  });

  await offlineContext.setOffline(true);
  await offlinePage.reload({ waitUntil: 'domcontentloaded', timeout: 30000 });
  await offlinePage.locator('main.studio').waitFor({ state: 'visible', timeout: 15000 });
  assert.match(await offlinePage.locator('h1').first().innerText(), /Card Studio/i);

  console.log('PASS mobile WebKit offline shell smoke');
} finally {
  await offlineContext.setOffline(false).catch(() => {});
  await offlineContext.close();
  await browser.close();
}
