FROM debian:stable-slim

RUN apt-get update && \
    apt-get install -y curl && \
    rm -rf /var/lib/apt/lists/*

# Control-flow blocks may use meaningful visual nesting and are ignored.
RUN if test -n "$OPTIONAL_VALUE"; then \
     echo "$OPTIONAL_VALUE" && \
    fi && \
    echo done

# Heredoc indentation can affect content and is ignored.
RUN <<EOF
one space is intentional here
EOF
