# Documentation screenshots

The public screenshots in this folder should reflect the current stable UI.
They may be generated from Scrubarr's browser regression fixture or captured
from a deliberately reviewed live install.

Before committing a live screenshot, confirm that it contains no API keys,
tokens, server URLs, private hostnames, filesystem paths, usernames, or other
sensitive information. Media titles and posters should only be included with
the library owner's approval.

From the repository root, regenerate them after a deliberate UI change:

```bash
npm run build
npm run docs:screenshots
```

The same fixture also powers `npm run test:ui:browser`, without replacing the
checked-in screenshots.
