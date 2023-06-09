import { Label, Webhook } from "./types";
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

    const { data: reviews } = await octokit.rest.pulls.listReviews({
      ...REPO_INFO,
      pull_number: pr.number,
    });

    const hasChangeset = Boolean((diff as unknown as string).includes(`pr-${pr.number}`));
    const isApproved = reviews.filter(r => r.state === "APPROVED").length >= 2;
    const isAdditionalApprovalNeeded = reviews.filter(r => r.state === "APPROVED").length === 1;
    const areChangesRequested = reviews.some(r => r.state === 'CHANGES_REQUESTED');

    const labelsToAdd = [];
    const labelsToRemove = [];

    if (hasChangeset) {
      labelsToRemove.push('Missing Changeset');
    } else {
      labelsToAdd.push('Missing Changeset');
    }

    if (isApproved) {
      labelsToAdd.push("Approved");
      labelsToRemove.push("Ready for Review");
      labelsToRemove.push("Add'tl Approval Needed");
    } else {
      labelsToRemove.push('Approved');
      labelsToAdd.push("Ready for Review");
    }

    if (isAdditionalApprovalNeeded) {
      labelsToAdd.push("Add'tl Approval Needed");
    } else {
      labelsToRemove.push("Add'tl Approval Needed");
    }

    if (areChangesRequested) {
      labelsToAdd.push("Requires Changes");
    } else {
      labelsToRemove.push("Requires Changes");
    }

    const labels = labelsToAdd.filter(label => !pr.pull_request.labels.some(l => l.name === label))

    if (labels.length > 0) {
      await octokit.rest.issues.addLabels({
        ...REPO_INFO,
        issue_number: pr.number,
        labels,
      });
    }

    for (const label of labelsToRemove) {
      // If the label isn't on the PR, there is no need to remove it
      if (!pr.pull_request.labels.find((l) => l.name === label)) {
        continue;
      }
      await octokit.rest.issues.removeLabel({
        ...REPO_INFO,
        issue_number: pr.number,
        name: label,
      });
    }

    return new Response(`Success`);
  },
};
