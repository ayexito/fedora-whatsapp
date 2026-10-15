FROM registry.fedoraproject.org/fedora@sha256:6ee5af99b2a80c00dbfd6d9589ca961886b58d35c2d7a161d988bd84cf363553
RUN dnf install -y cargo rust rustfmt gcc pkgconf-pkg-config gtk4-devel libadwaita-devel && dnf clean all
ENV CARGO_BUILD_JOBS=2
WORKDIR /work
