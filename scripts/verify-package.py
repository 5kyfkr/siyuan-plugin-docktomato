"""Check the release ZIP against the current production files."""
import json
import re
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent


def verify(package):
    manifest = json.loads((ROOT / 'plugin.json').read_text(encoding='utf-8-sig'))
    with zipfile.ZipFile(package) as archive:
        names = set()
        for entry in archive.infolist():
            name = entry.orig_filename
            if '\x00' in name or '\\' in name or name.startswith('/') or ':' in name or any(part in ('.', '..') for part in name.split('/')):
                raise ValueError('Invalid ZIP path: ' + name)
            if name in names:
                raise ValueError('Duplicate ZIP entry: ' + name)
            names.add(name)
            if re.match(r'^(\.git(?:/|$)|\.github/|\.codex-tmp/|\.playwright-cli/|output/|scripts/|docs/|node_modules/|PRODUCT\.md$|build\.(?:ps1|sh|bat)$|package\.zip$)', name):
                raise ValueError('Development file leaked into package: ' + name)
        required = {'plugin.json', 'index.js', 'tomato.js', 'kernel.js', 'index.css', 'icon.png', 'preview.png',
                    'README.md', 'README_zh_CN.md', 'i18n/en.json', 'i18n/zh-CN.json', 'i18n/runtime.js'}
        required.update(manifest['readme'].values())
        required.update(file.relative_to(ROOT).as_posix() for file in (ROOT / 'i18n').glob('*.json'))
        for name in required:
            if name not in names:
                raise ValueError('Package entry missing: ' + name)
            if archive.read(name) != (ROOT / name).read_bytes():
                raise ValueError('Package entry differs from source: ' + name)
    print(f"Package verified: {manifest['name']} {manifest['version']}, current sources, language bundles, READMEs and ZIP contents")


if __name__ == '__main__':
    try:
        verify(Path(sys.argv[1]) if len(sys.argv) > 1 else ROOT / 'package.zip')
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
