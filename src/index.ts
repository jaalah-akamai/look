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
      pull_number: pr.pull_request.number,
      mediaType: {
        format: 'diff',
      },
    });

    const { data: reviews } = await octokit.rest.pulls.listReviews({
      ...REPO_INFO,
      pull_number: pr.pull_request.number,
    });

    const hasChangeset = Boolean((diff as unknown as string).includes(`pr-${pr.pull_request.number}`));
    const isApproved = reviews.filter(r => r.state === "APPROVED").length >= 2;
    const isAdditionalApprovalNeeded = reviews.filter(r => r.state === "APPROVED").length === 1;
    const isReadyForReview = !isApproved && !isAdditionalApprovalNeeded;
    const areChangesRequested = reviews.some(r => r.state === 'CHANGES_REQUESTED');

    const labelsToAdd = [];
    const labelsToRemove = [];

    if (hasChangeset) {
      labelsToRemove.push('Missing Changeset');
    } else {
      if (pr.action === 'opened' || pr.action === 'reopened') {
        labelsToAdd.push('Missing Changeset');
      }
    }

    if (isApproved) {
      labelsToAdd.push("Approved");
    } else {
      labelsToRemove.push('Approved');
    }
    
    if (isReadyForReview) {
      labelsToAdd.push("Ready for Review");
    } else {
      labelsToRemove.push("Ready for Review");
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
        issue_number: pr.pull_request.number,
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
        issue_number: pr.pull_request.number,
        name: label,
      });
    }

    return new Response(`Success`);
  },
};
