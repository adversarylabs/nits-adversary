FROM debian:stable-slim

RUN git clone https://example.invalid/project.git /src && \
    cd /src && \
    mkdir build && \
    cd build && \
    cmake .. && \
     cmake --build . && \
    cmake --install .
