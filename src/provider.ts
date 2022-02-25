import { IConnectionMethods, IMessageParams } from "./interfaces";
import {
  JsonRpcId,
  JsonRpcVersion,
  JsonRpcEngine,
  JsonRpcRequest,
  JsonRpcError,
  getUniqueId,
  PendingJsonRpcResponse,
  JsonRpcResponse,
} from "json-rpc-engine";
import {
  providerFromEngine,
  createFetchMiddleware,
  providerFromMiddleware,
  createBlockRefMiddleware,
} from "eth-json-rpc-middleware";
import { createWalletMiddleware } from "./walletMiddleware";
import { PollingBlockTracker, Provider } from "eth-block-tracker";
import { Connection } from "penpal";
import { ethErrors } from "eth-rpc-errors";
import { SafeEventEmitterProvider } from "eth-json-rpc-middleware/dist/utils/cache";
import SafeEventEmitter from "@metamask/safe-event-emitter";

interface RequestArguments {
  method: string;
  params?: unknown[] | Record<string, unknown>;
}

class EthereumError extends Error implements JsonRpcError {
  code: number;
  message: string;
  data: string;
  constructor(code: number, message: string, data: string = "") {
    super(message);
    this.code = code;
    this.message = message;
    this.data = data;
  }
}

interface JsonRpcRequestArgs {
  id?: JsonRpcId;
  jsonrpc?: JsonRpcVersion;
  method: string;
  params?: unknown;
}

export class ArcanaProvider extends SafeEventEmitter {
  public onResponse = (method: string, response: any) => {
    this.subscriber.emit(`result:${method}:${response.id}`, response);
  };
  private jsonRpcEngine: JsonRpcEngine;
  private provider: SafeEventEmitterProvider;
  private subscriber: SafeEventEmitter;
  private communication: Connection<IConnectionMethods>;
  constructor() {
    super();
    this.initProvider();
    this.subscriber = new SafeEventEmitter();
  }

  public setConnection(connection: Connection<IConnectionMethods>) {
    this.communication = connection;
  }

  public getProvider() {
    if (!this.provider) {
      this.initProvider();
    }
    return this.provider;
  }

  public async isConnected() {
    try {
      const c = await this.communication.promise;
      return c.isLoggedIn();
    } catch (e) {
      console.log({ e });
      return false;
    }
  }

  public async triggerLogin(loginType: string) {
    const c = await this.communication.promise;
    await c.triggerLogin(loginType);
  }

  private initProvider() {
    this.initEngine();
    this.provider = providerFromEngine(this.jsonRpcEngine);
  }

  async request(args: RequestArguments) {
    if (!args || typeof args !== "object" || Array.isArray(args)) {
      throw ethErrors.rpc.invalidRequest({
        message: "Invalid request arguments",
        data: args,
      });
    }
    console.log({ args });

    const { method, params } = args;
    if (!method) {
      throw ethErrors.rpc.invalidRequest({
        message: "Invalid method argument",
        data: args,
      });
    }

    const req: JsonRpcRequest<unknown> = {
      method,
      params,
      jsonrpc: "2.0",
      id: getUniqueId(),
    };

    return new Promise((resolve, reject) => {
      this.rpcRequest(
        req,
        (
          error: Error,
          response: PendingJsonRpcResponse<{ result: string; error: string }>
        ): void => {
          if (error || response.error) {
            reject(error || response.error);
          } else {
            if (Array.isArray(response)) {
              resolve(response);
            }
            if (response.result?.error) {
              reject(error || response.result?.error);
            } else if (response.result?.result) {
              resolve(response.result.result);
            } else {
              resolve(response.result);
            }
          }
        }
      );
    });
  }

  protected rpcRequest(
    req: JsonRpcRequest<unknown> | JsonRpcRequest<unknown>[],
    callback: (...args: any[]) => void
  ) {
    if (!Array.isArray(req)) {
      return this.jsonRpcEngine.handle<
        unknown,
        JsonRpcResponse<{ result: string; error: string }>
      >(req as JsonRpcRequest<unknown>, callback);
    }

    return this.jsonRpcEngine.handle(
      req as JsonRpcRequest<unknown>[],
      callback
    );
  }

  private createRequest(method: string, params: unknown) {
    return {
      id: getUniqueId(),
      method,
      params: params,
      jsonrpc: "2.0",
    } as JsonRpcRequest<unknown>;
  }

  private initEngine() {
    this.jsonRpcEngine = new JsonRpcEngine();
    this.jsonRpcEngine.push(this.getWalletMiddleware());
    this.jsonRpcEngine.push(this.getBlockRefMiddleware());
  }

  private getWalletMiddleware() {
    const walletMiddleware = createWalletMiddleware({
      getAccounts: this.getAccounts,
      processEthSignMessage: this.ethSign,
      processPersonalMessage: this.personalSign,
      processSignTransaction: this.signTransaction,
      processEncryptionPublicKey: this.getPublicKey,
      processDecryptMessage: this.decrypt,
      processTypedMessageV4: this.processTypedMessageV4,
      processTransaction: this.processTransaction,
    });
    return walletMiddleware;
  }

  private getBlockRefMiddleware() {
    const fetchMiddleware = createFetchMiddleware({
      rpcUrl: "https://blockchain-testnet.arcana.network",
    });
    const blockProvider = providerFromMiddleware(fetchMiddleware);
    const blockTracker = new PollingBlockTracker({
      provider: blockProvider as Provider,
    });
    return createBlockRefMiddleware({ blockTracker, provider: blockProvider });
  }

  getAccounts = (): Promise<string[]> => {
    return new Promise(async (resolve, reject) => {
      const method = "eth_accounts";
      const c = await this.communication.promise;
      const r = this.createRequest(method, undefined);
      this.getResponse<string[]>(method, r.id).then(resolve, reject);
      await c.sendRequest(r);
    });
  };

  processTransaction = async (
    params: any,
    req: JsonRpcRequest<unknown>
  ): Promise<string> => {
    return new Promise(async (resolve, reject) => {
      const method = "eth_sendTransaction";
      const c = await this.communication.promise;
      this.getResponse<string>(method, req.id).then(resolve, reject);
      await c.sendRequest(req);
    });
  };

  processTypedMessageV4 = async (
    params: any,
    req: JsonRpcRequest<unknown>
  ): Promise<string> => {
    console.log({ req });
    return new Promise(async (resolve, reject) => {
      const method = "eth_signTypedData_v4";
      const c = await this.communication.promise;
      this.getResponse<string>(method, req.id).then(resolve, reject);
      await c.sendRequest(req);
    });
  };

  ethSign = async (
    params: any,
    req: JsonRpcRequest<unknown>
  ): Promise<string> => {
    return new Promise(async (resolve, reject) => {
      const method = "eth_sign";
      const c = await this.communication.promise;
      this.getResponse<string>(method, req.id).then(resolve, reject);
      await c.sendRequest(req);
    });
  };

  getPublicKey = async (address: string, req: any): Promise<string> => {
    console.log({ req });
    return new Promise(async (resolve, reject) => {
      const c = await this.communication.promise;
      this.getResponse<string>("eth_getEncryptionPublicKey", req.id).then(
        (res) => {
          resolve(res);
        }
      );
      await c.sendRequest(req);
    });
  };

  signTransaction = async (params: any, req: any): Promise<string> => {
    return new Promise(async (resolve, reject) => {
      const method = "eth_signTransaction";
      const c = await this.communication.promise;
      this.getResponse<string>(method, req.id).then(resolve, reject);
      await c.sendRequest(req);
    });
  };

  personalSign = async (
    params: any,
    req: JsonRpcRequest<unknown>
  ): Promise<string> => {
    console.log({ params, req });
    return new Promise(async (resolve, reject) => {
      const c = await this.communication.promise;
      this.getResponse<string>("personal_sign", req.id).then((res) => {
        resolve(res);
      });
      await c.sendRequest(req);
    });
  };

  decrypt = async (params: IMessageParams, req: any): Promise<string> => {
    console.log({ req });
    return new Promise(async (resolve, reject) => {
      const c = await this.communication.promise;
      this.getResponse<string>("eth_decrypt", req.id).then((res) => {
        resolve(res);
      });
      await c.sendRequest(req);
    });
  };

  getResponse<U>(method: string, id: JsonRpcId): Promise<U> {
    return new Promise((resolve, reject) => {
      this.subscriber.once(
        `result:${method}:${id}`,
        (params: { error: string; result: U }) => {
          console.log("Get response: ", { params });
          if (params.error) {
            return reject(getError(params.error));
          }
          return resolve(params.result);
        }
      );
    });
  }
}

const getError = (message: string) => {
  if (message == "user_deny") {
    return new EthereumError(4001, "The request was denied by the user");
  } else {
    return new EthereumError(-32603, "Internal error");
  }
};