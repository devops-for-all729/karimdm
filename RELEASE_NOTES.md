# KarimDM 1.0.0

Free portable download manager for Karim, Windows 10/11 x64.

Download the `.exe` asset below. No Node.js or Python installation is needed.

Features: parallel byte-range transfers, persistent pause/resume, download queue, concurrency settings, URL paste/drop, folder picker, speed/progress/ETA, and safe filename collision handling.

Limits: direct HTTP/HTTPS file URLs only, no browser extension, no authenticated browser cookies, no DRM/video extraction. Resume requires a stable file, byte-range support and a usable server validator. Unsupported servers restart single-stream. Multiple connections do not guarantee greater speed.

The application is not code-signed. Windows may show an unknown-publisher warning. Verify the SHA-256 against SHA256SUMS.txt and use your usual security checks. Do not disable antivirus protection.

Release publication is gated on Windows engine tests, full GUI pause/restart/resume and checksum tests, followed by a packaged portable-EXE launch/download/resume/checksum diagnostic. Test files use deterministic loopback HTTP servers; this is not a claim of compatibility with every public download host.
