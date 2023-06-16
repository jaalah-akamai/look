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

    const activeReviews: typeof reviews = [];

    for (let i = reviews.length - 1; i >= 0; i--) {
      if (!activeReviews.some(r => r.user.id === reviews[i].user.id)) {
        activeReviews.push(reviews[i]);
      }
    }

    const hasChangeset = Boolean((diff as unknown as string).includes(`pr-${pr.pull_request.number}`));
    const isApproved = activeReviews.filter(r => r.state === "APPROVED").length >= 2;
    const isAdditionalApprovalNeeded = activeReviews.filter(r => r.state === "APPROVED").length === 1;
    const isReadyForReview = !isApproved && !isAdditionalApprovalNeeded;
    const areChangesRequested = activeReviews.some(r => r.state === 'CHANGES_REQUESTED');

    const isStaging = pr.pull_request.base.ref === 'staging';
    const isMaster = pr.pull_request.base.ref === 'master';
    const isUpdate = pr.pull_request.base.ref === 'develop' && isMaster;
    const isHotfix = pr.pull_request.title.toLowerCase().includes('hotfix')

    const labelsToAdd = [];
    const labelsToRemove = [];

    if (hasChangeset) {
      labelsToRemove.push('Missing Changeset');
    } else {
      if (pr.action === 'opened' || pr.action === 'reopened') {
        labelsToAdd.push('Missing Changeset');
      }
    }

    if (isStaging) {
      labelsToAdd.push("Release → Staging");
    } else if (isMaster) {
      labelsToAdd.push("Release");
    } else if (isUpdate) {
      labelsToAdd.push("Master → Develop");
    }

    if (isHotfix) {
      labelsToAdd.push("Hotfix");
    } else {
      labelsToRemove.push("Hotfix");
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
