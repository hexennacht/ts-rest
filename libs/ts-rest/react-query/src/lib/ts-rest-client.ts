import { z, ZodTypeAny } from 'zod';
import {
  AppRoute,
  AppRouteMutation,
  AppRouteQuery,
  AppRouter,
  ClientArgs,
  DataReturn,
  defaultApi,
  getRouteQuery,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  AppRouterResponseWithStatusCodeSupport,
  isAppRoute,
  SuccessfulHttpStatusCode,
  Without,
  ZodInferOrType,
  HTTPStatusCode,
} from '@ts-rest/core';
import {
  QueryFunction,
  QueryKey,
  useMutation,
  UseMutationOptions,
  UseMutationResult,
  useQuery,
  UseQueryOptions,
  UseQueryResult,
} from '@tanstack/react-query';

type RecursiveProxyObj<T extends AppRouter> = {
  [TKey in keyof T]: T[TKey] extends AppRouter
    ? RecursiveProxyObj<T[TKey]>
    : T[TKey] extends AppRoute
    ? Without<UseQueryArgs<T[TKey]>, never>
    : never;
};

type AppRouteMutationType<T> = T extends ZodTypeAny ? z.infer<T> : T;

type UseQueryArgs<TAppRoute extends AppRoute> = {
  useQuery: TAppRoute extends AppRouteQuery
    ? DataReturnQuery<TAppRoute>
    : never;
  query: TAppRoute extends AppRouteQuery ? DataReturn<TAppRoute> : never;
  useMutation: TAppRoute extends AppRouteMutation
    ? DataReturnMutation<TAppRoute>
    : never;
  mutation: TAppRoute extends AppRouteMutation ? DataReturn<TAppRoute> : never;
};

type DataReturnArgs<TRoute extends AppRoute> = {
  body: TRoute extends AppRouteMutation
    ? AppRouteMutationType<TRoute['body']> extends null
      ? never
      : AppRouteMutationType<TRoute['body']>
    : never;
  params: Parameters<TRoute['path']>[0] extends null
    ? never
    : Parameters<TRoute['path']>[0];
  query: TRoute['query'] extends ZodTypeAny
    ? AppRouteMutationType<TRoute['query']> extends null
      ? never
      : AppRouteMutationType<TRoute['query']>
    : never;
};

/**
 * Based on {@link AppRouterResponseWithStatusCodeSupport}
 *
 * Split up the data and error to support react-query style
 * useQuery and useMutation error handling
 */
type SuccessResponseMapper<T> = T extends {
  [key: string]: unknown;
}
  ?
      | {
          [K in keyof T]: K extends SuccessfulHttpStatusCode
            ? { status: K; data: ZodInferOrType<T[K]> }
            : never;
        }[keyof T]
  : ZodInferOrType<T>;

/**
 * Based on {@link AppRouterResponseWithStatusCodeSupport}
 *
 * Returns any handled errors, or any unhandled non success errors
 */
type ErrorResponseMapper<T> = T extends {
  [key: string]: unknown;
}
  ?
      | {
          [K in keyof T]: K extends SuccessfulHttpStatusCode
            ? never
            : { status: K; data: ZodInferOrType<T[K]> };
        }[keyof T]
      // If the response isn't one of our typed ones. Return "unknown"
      | {
          status: Exclude<HTTPStatusCode, keyof T | SuccessfulHttpStatusCode>;
          data: unknown;
        }
  : ZodInferOrType<T>;

// Data response if it's a 2XX
type DataResponse<T extends AppRoute> = SuccessResponseMapper<T['response']>;

// Error response if it's not a 2XX
type ErrorResponse<T extends AppRoute> = ErrorResponseMapper<T['response']>;

// Used on X.useQuery
type DataReturnQuery<TAppRoute extends AppRoute> = (
  queryKey: QueryKey,
  args: Without<DataReturnArgs<TAppRoute>, never>,
  options?: UseQueryOptions<DataResponse<TAppRoute>, ErrorResponse<TAppRoute>>
) => UseQueryResult<DataResponse<TAppRoute>, ErrorResponse<TAppRoute>>;

// Used pn X.useMutation
type DataReturnMutation<TAppRoute extends AppRoute> = (
  options?: UseMutationOptions<
    DataResponse<TAppRoute>,
    ErrorResponse<TAppRoute>,
    Without<DataReturnArgs<TAppRoute>, never>,
    unknown
  >
) => UseMutationResult<
  DataResponse<TAppRoute>,
  ErrorResponse<TAppRoute>,
  Without<DataReturnArgs<TAppRoute>, never>,
  unknown
>;

const getCompleteUrl = (query: any, baseUrl: string, path: string) => {
  const queryString =
    typeof query === 'object'
      ? Object.keys(query)
          .map((key) => {
            return (
              encodeURIComponent(key) + '=' + encodeURIComponent(query[key])
            );
          })
          .join('&')
      : '';

  const completeUrl = `${baseUrl}${path}${
    queryString.length > 0 && queryString !== null && queryString !== undefined
      ? '?' + queryString
      : ''
  }`;

  return completeUrl;
};

const getRouteUseQuery = <TAppRoute extends AppRoute>(
  route: TAppRoute,
  clientArgs: ClientArgs
) => {
  return (
    queryKey: QueryKey,
    args: DataReturnArgs<TAppRoute>,
    options?: UseQueryOptions<TAppRoute['response']>
  ) => {
    const dataFn: QueryFunction<TAppRoute['response']> = async () => {
      const path = route.path(args.params);

      const completeUrl = getCompleteUrl(args.query, clientArgs.baseUrl, path);

      const result = await defaultApi({
        path: completeUrl,
        method: route.method,
        headers: {
          ...clientArgs.baseHeaders,
        },
        body: undefined,
      });

      // If the response is not a 2XX, throw an error
      if (!String(result.status).startsWith('2')) {
        throw result;
      }

      console.log(result, route.response);
      // If the AppRoute is a { [key: number]: any}

      if (
        route.response instanceof Object &&
        Object.keys(route.response).length > 0 &&
        Object.keys(route.response).every((key) => {
          const keyAsNumber = Number(key);

          return keyAsNumber !== keyAsNumber;
        })
      ) {
        return result.data;
      } else {
        return result;
      }
    };

    return useQuery(queryKey, dataFn, options);
  };
};

const getRouteUseMutation = <TAppRoute extends AppRoute>(
  route: TAppRoute,
  clientArgs: ClientArgs
) => {
  return (options?: UseMutationOptions<TAppRoute['response']>) => {
    const mutationFunction = async (args: DataReturnArgs<TAppRoute>) => {
      const path = route.path(args.params);

      const completeUrl = getCompleteUrl(args.query, clientArgs.baseUrl, path);

      const result = await defaultApi({
        path: completeUrl,
        method: route.method,
        headers: {
          ...clientArgs.baseHeaders,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(args.body),
      });

      return result.data;
    };

    return useMutation(
      mutationFunction as () => Promise<ZodInferOrType<TAppRoute['response']>>,
      options
    );
  };
};

const createNewProxy = (router: AppRouter | AppRoute, args: ClientArgs) => {
  return new Proxy(
    {},
    {
      get: (_, propKey): any => {
        if (isAppRoute(router)) {
          switch (propKey) {
            case 'query':
              throw getRouteQuery(router, args);
            case 'mutation':
              throw getRouteQuery(router, args);
            case 'useQuery':
              return getRouteUseQuery(router, args);
            case 'useMutation':
              return getRouteUseMutation(router, args);
            default:
              throw new Error(`Unknown method called on ${String(propKey)}`);
          }
        } else {
          const subRouter = router[propKey as string];

          return createNewProxy(subRouter, args);
        }
      },
    }
  );
};

export type InitClientReturn<T extends AppRouter> = RecursiveProxyObj<T>;

export const initQueryClient = <T extends AppRouter>(
  router: T,
  args: ClientArgs
): InitClientReturn<T> => {
  const proxy = createNewProxy(router, args);

  return proxy as InitClientReturn<T>;
};
