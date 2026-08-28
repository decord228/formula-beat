# Formula Beat

Браузерная ритм-игра, в которой bytebeat, signed bytebeat, floatbeat и funcbeat-формулы одновременно создают музыку, визуализацию и игровую карту.

## Возможности

- редактор собственных формул с тихим live-preview;
- режимы Bytebeat, Signed 8-bit, Floatbeat и Funcbeat;
- четыре дорожки в стиле piano tiles, обычные ноты и удержания;
- динамическое выделение ритмических событий из генерируемого аудио;
- сложности Flow, Pulse и Overdrive;
- модификаторы Autobot, No Fail и Hidden;
- реактивный фон, частицы и полноценная сцена поражения;
- адаптивная оптимизация тяжёлых формул.

## Локальный запуск

Нужен Node.js 22.13 или новее.

```bash
npm install
npm run dev
```

Обычная проверка сборки:

```bash
npm run build
```

Статическая сборка для GitHub Pages:

```bash
npm run build:pages
```

После каждого push в `main` GitHub Actions автоматически обновляет GitHub Pages.
