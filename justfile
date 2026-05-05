set dotenv-load
set positional-arguments

export PATH := source_dir() + '/node_modules/.bin' + PATH_VAR_SEP + env_var('PATH')

@default:
  just --list --unsorted

init:
  git submodule update --init --recursive
  bun install

# Build the extension into dist/
build:
  just build-js
  just build-css

# Watch JS, CSS, and static files, rebuilding/copying on save
watch:
  concurrently --kill-others --names 'js,css,static' --prefix "[{name}]" \
    "just watch-js" \
    "just watch-css" \
    "just watch-static"

build-js:
  bun build --target=browser --format=esm --outdir=dist src/popup.ts src/background.ts src/offscreen.ts src/tab-inventory.ts

watch-js:
  bun build --target=browser --format=esm --outdir=dist --watch src/popup.ts src/background.ts src/offscreen.ts src/tab-inventory.ts

build-css:
  tailwindcss -i src/popup.css -o dist/popup.css

watch-css:
  tailwindcss -i src/popup.css -o dist/popup.css --watch

build-static:
  cp src/popup.html dist/popup.html
  cp src/offscreen.html dist/offscreen.html
  cp src/tab-inventory.html dist/tab-inventory.html
  cp src/manifest.json dist/manifest.json

watch-static:
  # apparently chokidar --initial doesn't work with {path} templates?
  # So build before watch
  just build-static
  chokidar 'src/popup.html' 'src/offscreen.html' 'src/tab-inventory.html' 'src/manifest.json' -c "cp '{path}' dist/"
