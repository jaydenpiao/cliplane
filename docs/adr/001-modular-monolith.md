# ADR 001: Modular control plane with stateless media workers

Accepted for the initial vertical slice.

The TypeScript API owns authorization, workflow and job persistence. Next.js owns the
studio. Python runs media/ML-oriented work via versioned JSON requests; FFmpeg executes
the transforms. Worker processes have no database credentials or external network
purpose. This follows the report without introducing Redis or distributed services.

Consequences: API deployments must supervise the job loop; processing survives restarts
through leases. Native decoders still require OS/container isolation before public use.
Multiple API instances must use the same storage mount until S3 storage is added.
