import { Webhook } from "./types";
import { Octokit } from "octokit";

const BOT_USERNAME = 'bnussman';

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

    if (!['opened', 'edited', 'reopened', 'synchronize'].includes(pr.action)) {
      return new Response(`Success, but did nothing!`);
    }

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

    const body = hasChangeset ? "Your PR has a changeset ✅" : "Please add a chageset to your PR 🥺🚨";

    const { data: comments } = await octokit.rest.issues.listComments({
      ...REPO_INFO,
      issue_number: pr.number
    });

    const existingComment = comments.find(comment => comment.user?.login === BOT_USERNAME)

    if (existingComment?.body === body) {
      return new Response(`Success, but did nothing!`);
    }

    if (existingComment) {
      await octokit.rest.issues.updateComment({
        ...REPO_INFO,
        comment_id: existingComment.id,
        body
      });
    } else {
      await octokit.rest.issues.createComment({
        ...REPO_INFO,
        issue_number: pr.number,
        body
      });
    }

    return new Response(`Success`);
  },
};
