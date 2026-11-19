FROM alpine:3.24@sha256:f59abe656b692d901e184be3445e084786602108599d2a51d229c0f5a48c71bf

RUN apk add --no-cache python3 ffmpeg font-dejavu && mkdir -p /input /work && touch /input/source
WORKDIR /decoder
COPY --chown=0:0 --chmod=0444 pipeline.py artifact_protocol.py decoder.py ./
ENV TMPDIR=/work HOME=/work
USER 65534:65534
ENTRYPOINT ["/usr/bin/python3", "-B", "-u", "/decoder/decoder.py"]
