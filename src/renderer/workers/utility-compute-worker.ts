/** P7 — off-main-thread Myers diff and Utility Pipeline execution. */

import { runPipeline } from '../../shared/utilityPipeline';
import { computeDiff } from '../utils/diff';
import type {
  UtilityComputeRequest,
  UtilityComputeResponse,
} from '../runtime/utilityComputeProtocol';

const ctx = self as unknown as Worker;

function reply(message: UtilityComputeResponse): void {
  ctx.postMessage(message);
}

ctx.addEventListener(
  'message',
  (event: MessageEvent<UtilityComputeRequest>) => {
    const request = event.data;
    void (async () => {
      try {
        if (request.type === 'diff') {
          reply({
            type: 'diff-result',
            requestId: request.requestId,
            segments: computeDiff(
              request.left,
              request.right,
              request.granularity
            ),
          });
          return;
        }

        const outcome = await runPipeline(request.pipeline, request.input, {
          ...(request.stepTimeoutMs === undefined
            ? {}
            : { stepTimeoutMs: request.stepTimeoutMs }),
          skipYield: true,
          onStepSettled: (result) => {
            reply({
              type: 'pipeline-step',
              requestId: request.requestId,
              result,
            });
          },
        });
        reply({
          type: 'pipeline-result',
          requestId: request.requestId,
          outcome,
        });
      } catch (error) {
        reply({
          type: 'error',
          requestId: request.requestId,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    })();
  }
);
