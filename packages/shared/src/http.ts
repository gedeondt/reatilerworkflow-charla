import { request as httpRequest, type RequestOptions as HttpRequestOptions } from 'node:http';
import { request as httpsRequest, type RequestOptions as HttpsRequestOptions } from 'node:https';
import { URL } from 'node:url';
import { Readable } from 'node:stream';

export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export interface HttpRequestOptionsExtended {
  method?: HttpMethod;
  headers?: Record<string, string>;
  body?: string | Buffer | Readable | Record<string, unknown>;
  timeoutMs?: number;
}

export interface HttpResponse<T = Buffer> {
  statusCode: number;
  headers: Record<string, string | string[] | undefined>;
  body: T;
}

export async function httpFetch(urlString: string, options: HttpRequestOptionsExtended = {}): Promise<HttpResponse<Buffer>> {
  const url = new URL(urlString);
  const isHttps = url.protocol === 'https:';
  const requestFn = isHttps ? httpsRequest : httpRequest;

  const requestOptions: HttpRequestOptions & HttpsRequestOptions = {
    method: options.method ?? 'GET',
    headers: { ...(options.headers ?? {}) },
    hostname: url.hostname,
    port: url.port || (isHttps ? 443 : 80),
    path: `${url.pathname}${url.search}`
  };

  let bodyToSend: string | Buffer | Readable | undefined = options.body as any;
  if (
    bodyToSend &&
    typeof bodyToSend === 'object' &&
    !(bodyToSend instanceof Buffer) &&
    !(bodyToSend instanceof Readable)
  ) {
    bodyToSend = JSON.stringify(bodyToSend);
    requestOptions.headers = {
      'content-type': 'application/json',
      ...requestOptions.headers
    };
  }

  return new Promise((resolve, reject) => {
    const req = requestFn(requestOptions, (res) => {
      const chunks: Buffer[] = [];

      res.on('data', (chunk) => {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });

      res.on('end', () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          headers: res.headers,
          body: Buffer.concat(chunks)
        });
      });
    });

    req.on('error', reject);

    if (options.timeoutMs) {
      req.setTimeout(options.timeoutMs, () => {
        req.destroy(new Error(`Request timed out after ${options.timeoutMs}ms`));
      });
    }

    if (bodyToSend instanceof Readable) {
      bodyToSend.pipe(req);
      return;
    }

    if (bodyToSend !== undefined) {
      req.write(bodyToSend);
    }

    req.end();
  });
}
