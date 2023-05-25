export interface Env {
  
}

export default {
	async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const body = await request.json();
    console.log(body)
		return new Response(`Hello World from ${request.method}!`);
	},
};
