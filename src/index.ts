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

    // Labels
    const missingChangesetLabel = 'Missing Changeset';
    const stagingLabel = 'Release → Staging';
    const releaseLabel = 'Release';
    const masterDevelopLabel = 'Master → Develop';
    const hotfixLabel = 'Hotfix';
    const approvedLabel = 'Approved';
    const readyForReviewLabel = 'Ready for Review';
    const additionalApprovalLabel = "Add'tl Approval Needed";
    const changesRequestedLabel = 'Requires Changes';

    // Keep track of labels that have already been added so we don't add them again
    const uniqueAddedLabels = new Set();

    // Labels that should be added / removed from the PR
    const labels = new Set();

    if (hasChangeset) {
      labels.delete(missingChangesetLabel);
    } else {
      if (
        pr.action === 'opened' ||
        (pr.action === 'reopened' &&
          !uniqueAddedLabels.has(missingChangesetLabel))
      ) {
        uniqueAddedLabels.add(missingChangesetLabel);
        labels.add(missingChangesetLabel);
      }
    }

    if (isStaging) {
      if (!uniqueAddedLabels.has(stagingLabel)) {
        uniqueAddedLabels.add(stagingLabel);
        labels.add(stagingLabel);
      }
    } else if (isMaster) {
      if (!uniqueAddedLabels.has(releaseLabel)) {
        uniqueAddedLabels.add(releaseLabel);
        labels.add(releaseLabel);
      }
    } else if (isUpdate) {
      if (!uniqueAddedLabels.has(masterDevelopLabel)) {
        uniqueAddedLabels.add(masterDevelopLabel);
        labels.add(masterDevelopLabel);
      }
    }

    if (isHotfix) {
      if (!uniqueAddedLabels.has(hotfixLabel)) {
        uniqueAddedLabels.add(hotfixLabel);
        labels.add(hotfixLabel);
      }
    } else {
      labels.delete(hotfixLabel);
    }

    if (isApproved) {
      if (!uniqueAddedLabels.has(approvedLabel)) {
        uniqueAddedLabels.add(approvedLabel);
        labels.add(approvedLabel);
      }
    } else {
      labels.delete(approvedLabel);
    }

    if (isReadyForReview) {
      if (!uniqueAddedLabels.has(readyForReviewLabel)) {
        uniqueAddedLabels.add(readyForReviewLabel);
        labels.add(readyForReviewLabel);
      }
    } else {
      labels.delete(readyForReviewLabel);
    }

    if (isAdditionalApprovalNeeded) {
      if (!uniqueAddedLabels.has(additionalApprovalLabel)) {
        uniqueAddedLabels.add(additionalApprovalLabel);
        labels.add(additionalApprovalLabel);
      }
    } else {
      labels.delete(additionalApprovalLabel);
    }

    if (areChangesRequested) {
      if (!uniqueAddedLabels.has(changesRequestedLabel)) {
        uniqueAddedLabels.add(changesRequestedLabel);
        labels.add(changesRequestedLabel);
      }
    } else {
      labels.delete(changesRequestedLabel);
    }

    const filteredLabels = Array.from(labels).filter(label => !pr.pull_request.labels.some(l => l.name === label))

    if (filteredLabels.length > 0) {
      await octokit.rest.issues.addLabels({
        ...REPO_INFO,
        issue_number: pr.pull_request.number,
        filteredLabels,
      });
    }

    for (const label of filteredLabels) {
      // If the label isn't on the PR, there is no need to remove it
      if (!pr.pull_request.labels.find((l) => l.name === label)) {
        continue;
      }
      try {
        await octokit.rest.issues.removeLabel({
          ...REPO_INFO,
          issue_number: pr.pull_request.number,
          name: label as string,
        });
      } catch(error) {
        console.error("Unable to delete label", label, "on PR", pr.pull_request.id, "with labels", pr.pull_request.labels);
      }
    }

    return new Response(`Success`);
  },
};
