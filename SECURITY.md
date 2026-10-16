# Security

The app loads the official WhatsApp Web client. It has no developer server and does not embed an account or saved login in its source. WhatsApp provides messaging and its encryption.

Your session is stored under `~/.local/share/io.github.whatsapp_fedora.Desktop/`; browser caches are under `~/.cache/io.github.whatsapp_fedora.Desktop/`. These locations follow `XDG_DATA_HOME` and `XDG_CACHE_HOME` when set. Never upload either directory, QR codes, tokens, chat contents or account logs.

Session folders have mode 0700. This restricts other Linux users, but does not protect against root or malware running as your user. Disk/keyring encryption has not been independently verified. If session data is exposed, revoke the linked device using WhatsApp on your phone.

Keep Electron and Fedora updated. The app enables the renderer sandbox, context isolation and TLS certificate validation, and disables Node integration in web content. A trusted local runtime and executable remain part of the security boundary. A source review is not a guarantee against unknown vulnerabilities.

The local title bar has a sandboxed preload for its three window buttons. Commands are accepted only from that exact local document's main frame. The remote WhatsApp WebContentsView has no preload or native IPC bridge. Close hides the window and keeps that view and its session running. **Application → Quitter** or **Ctrl+Q** closes the view and quits the app completely.

Attachment downloads require the official WhatsApp Web origin as initiator in the main application window. An official-origin blob document popup can also authorize one download of that exact blob URL in the same window; navigation clears this authorization. This exception permits an empty initiator only for that requested blob. Chromium handles the transfer and shows a native Save dialog; suggested filenames are restricted to a filename within the Downloads folder. The user chooses the actual destination and confirms any overwrite. Downloaded files never open automatically. Showing a saved file in its folder or opening it requires a separate click. The Open action is limited to an extension allowlist of documents and media, and rechecks that the destination is a regular, non-symlink file without executable permission bits. An allowed extension does not establish that a file is safe; the default application handles its contents.

External HTTP/HTTPS links open in the default browser rather than replacing the WhatsApp page. Credentials in URLs and custom schemes are blocked. Popup windows do not receive an in-app browser or native runtime access.

Microphone, camera and speaker-selection access requires consent in a native dialog, limited to the exact `https://web.whatsapp.com` origin in the main window. Other origins, subframes and permission types are denied. Setup asks on the first trusted load and remembers the choice, including denial, to avoid repeated setup prompts. Grants are stored in `media-permissions.json` with mode 0600 inside the private Chromium profile. Missing, invalid or insecure permission files grant no access. The visible Application menu can remove saved grants and reload the page; a failure to save a revocation is reported. Requests lose validity if their document navigates or permissions are revoked before consent completes. The setup dialog itself does not start capture.

Desktop notifications have a separate remembered permission in the same private file. Only the official client view's main frame can request it. The official web client supplies notification content through Chromium's standard notification API; it is not copied into application logs or sent to a developer server. Notification text may be visible on your desktop or lock screen according to WhatsApp and desktop settings. No notification service runs after the app quits.

Report security problems privately through [GitHub's vulnerability reporting page](https://github.com/ayexito/fedora-whatsapp/security). Do not attach account data to public issues.
