"""Writes src/icons.ts from Potok's copy of Heroicons, so the map's buttons
draw the same icons as the page. Heroicons comes with potok-ide's
dependencies: run `mix deps.get` there first, with potok-ide next to this
project, then `python scripts/icons.py` here. Heroicons is MIT licensed by
Tailwind Labs; its notice goes into the file it writes and is in
THIRD_PARTY_NOTICES.md.

The pins themselves are not here: the page sends their drawings with the map's
config (`getMapConfig`), so a new pin needs no new build."""

import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
HERO = HERE.parents[1] / "potok-ide" / "deps" / "heroicons" / "optimized" / "24"
OUT = HERE.parent / "src" / "icons.ts"

OUTLINE = {
    "fit": "arrows-pointing-out",
    "list": "list-bullet",
    "plus": "plus",
    "close": "x-mark",
    "bookmark": "bookmark",
    "pin": "map-pin",
    "check": "check",
    "retry": "arrow-path",
    "map": "map",
    "lock": "lock-closed",
    "home": "home",
    "layers": "square-3-stack-3d",
    "area": "viewfinder-circle",
    "zoomIn": "magnifying-glass-plus",
    "search": "magnifying-glass",
    "open": "arrow-top-right-on-square",
    "route": "arrow-turn-up-right",
    "legend": "tag",
}

# Kept by the bundler as a legal comment, so the build carries it too.
NOTICE = """/**
 * @license Heroicons, https://github.com/tailwindlabs/heroicons
 *
 * MIT License
 *
 * Copyright (c) Tailwind Labs, Inc.
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */
"""


def paths(file: Path) -> list[str]:
    if not file.exists():
        sys.exit(f"{file} is missing: run `mix deps.get` in potok-ide first")
    found = re.findall(r'\sd="([^"]+)"', file.read_text(encoding="utf-8"))
    if not found:
        sys.exit(f"no path in {file}")
    return found


def main() -> None:
    lines = [f"  {name}: '{' '.join(paths(HERO / 'outline' / f'{hero}.svg'))}'," for name, hero in OUTLINE.items()]

    OUT.write_text(
        "// Icons from Heroicons, the set Potok's page draws with: outline, 24×24,\n"
        "// with a 1.5 stroke. Written by scripts/icons.py from potok-ide's\n"
        "// deps/heroicons.\n"
        "\n" + NOTICE + "\n"
        "import { html, type TemplateResult } from 'lit-html';\n"
        "\n"
        "const PATHS = {\n" + "\n".join(lines) + "\n};\n"
        "\n"
        "export type IconName = keyof typeof PATHS;\n"
        "\n"
        "export function icon(name: IconName, className = 'size-5'): TemplateResult {\n"
        "  return html`<svg\n"
        "    class=${className}\n"
        '    viewBox="0 0 24 24"\n'
        '    fill="none"\n'
        '    stroke="currentColor"\n'
        '    stroke-width="1.5"\n'
        '    stroke-linecap="round"\n'
        '    stroke-linejoin="round"\n'
        '    aria-hidden="true"\n'
        "  ><path d=${PATHS[name]}></path></svg>`;\n"
        "}\n",
        encoding="utf-8",
        newline="\n",
    )


if __name__ == "__main__":
    main()
