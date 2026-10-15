# Security

The app loads the official WhatsApp Web client. It has no developer server and does not embed an account or saved login in its source. WhatsApp provides messaging and its encryption.

Your session is stored under `~/.local/share/io.github.whatsapp_fedora.Desktop/`; browser caches are under `~/.cache/io.github.whatsapp_fedora.Desktop/`. These locations follow `XDG_DATA_HOME` and `XDG_CACHE_HOME` when set. Never upload either directory, QR codes, tokens, chat contents or account logs.

Session folders have mode 0700. This restricts other Linux users, but does not protect against root or malware running as your user. Disk/keyring encryption has not been independently verified. If session data is exposed, revoke the linked device using WhatsApp on your phone.

Keep Electron and Fedora updated. The app enables the renderer sandbox, context isolation and TLS certificate validation, and disables Node integration in web content. A trusted local runtime and executable remain part of the security boundary. A source review is not a guarantee against unknown vulnerabilities.

Report security problems privately through [GitHub's vulnerability reporting page](https://github.com/ayexito/whatsapp-for-fedora/security). Do not attach account data to public issues.
