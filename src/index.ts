import { Webhook } from "./types";
import { Octokit } from "octokit";

const REPO_INFO = {
  owner: 'linode',
  repo: 'manager',
};

export interface Env {
  GITHUB_TOKEN: string;
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {

    const octokit = new Octokit({ auth: env.GITHUB_TOKEN });

    const pr = await request.json<Webhook>();

    if (pr.pull_request.draft) {
      return new Response(`Doing nothing because PR is a draft`);
    }

    const { data: diff } = await octokit.rest.pulls.get({
      ...REPO_INFO,
      pull_number: pr.number,
      mediaType: {
        format: 'diff',
      },
    });

    const hasChangeset = Boolean((diff as unknown as string).includes(`pr-${pr.number}`));

    if (hasChangeset) {
      await octokit.rest.issues.addLabels({
        ...REPO_INFO,
        issue_number: pr.number,
        labels: ['Missing Changeset']
      });
    } else {
      await octokit.rest.issues.removeLabel({
        ...REPO_INFO,
        issue_number: pr.number,
        name: 'Missing Changeset',
      });
    }

    return new Response(`Success`);
  },
};
