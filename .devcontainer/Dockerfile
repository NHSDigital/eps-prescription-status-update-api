FROM ghcr.io/nhsdigital/eps-devcontainers:latest

# provide DOCKER_GID via build args if you need to force group id to match host
ARG DOCKER_GID
ARG TARGETARCH
ENV TARGETARCH=${TARGETARCH}

ARG ASDF_VERSION
COPY .tool-versions.asdf /tmp/.tool-versions.asdf

USER root

# specify DOCKER_GID to force container docker group id to match host
RUN if [ -n "${DOCKER_GID}" ]; then \
      if ! getent group docker; then \
        groupadd -g ${DOCKER_GID} docker; \
      else \
        groupmod -g ${DOCKER_GID} docker; \
      fi && \
      usermod -aG docker vscode; \
    fi

USER vscode

WORKDIR /workspaces/eps-prescription-status-update-api
ADD .tool-versions /workspaces/eps-prescription-status-update-api/.tool-versions
ADD .tool-versions /home/vscode/.tool-versions

# install python before poetry to ensure correct python version is used
RUN asdf install python && \
    asdf install
