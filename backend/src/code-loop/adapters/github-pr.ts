export type GitHubPrAdapterConfig = {
  token?: string;
  owner?: string;
  repo?: string;
  baseBranch?: string;
  apiBaseUrl?: string;
};

export type CreateGitHubPrInput = {
  branchName: string;
  title: string;
  body: string;
  draft?: boolean;
};

export type GitHubPrResult = {
  url: string;
  number: number;
  head: string;
  base: string;
};

function assertConfig(config: GitHubPrAdapterConfig): asserts config is Required<Pick<GitHubPrAdapterConfig, 'token' | 'owner' | 'repo'>> &
  GitHubPrAdapterConfig {
  if (!config.token) throw new Error('github_token_missing');
  if (!config.owner || !config.repo) throw new Error('github_repository_missing');
}

function apiBase(config: GitHubPrAdapterConfig): string {
  return config.apiBaseUrl ?? 'https://api.github.com';
}

function buildHeaders(token: string): Record<string, string> {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28'
  };
}

async function requestJson<T>(url: string, init: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  if (!response.ok) {
    const message = await response.text();
    throw new Error(`github_api_error:${response.status}:${message.slice(0, 240)}`);
  }
  return (await response.json()) as T;
}

export async function createGitHubBranchAndPr(
  config: GitHubPrAdapterConfig,
  input: CreateGitHubPrInput
): Promise<GitHubPrResult> {
  assertConfig(config);

  const base = config.baseBranch ?? 'main';
  const root = `${apiBase(config)}/repos/${config.owner}/${config.repo}`;
  const headers = buildHeaders(config.token);

  const baseRef = await requestJson<{ object?: { sha?: string } }>(`${root}/git/ref/heads/${base}`, {
    method: 'GET',
    headers
  });
  const sha = baseRef.object?.sha;
  if (!sha) {
    throw new Error('github_base_sha_missing');
  }

  const createRefResponse = await fetch(`${root}/git/refs`, {
    method: 'POST',
    headers: {
      ...headers,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ref: `refs/heads/${input.branchName}`,
      sha
    })
  });
  if (!createRefResponse.ok && createRefResponse.status !== 422) {
    const message = await createRefResponse.text();
    throw new Error(`github_branch_create_failed:${createRefResponse.status}:${message.slice(0, 240)}`);
  }

  const pr = await requestJson<{ html_url: string; number: number; head?: { ref?: string }; base?: { ref?: string } }>(
    `${root}/pulls`,
    {
      method: 'POST',
      headers: {
        ...headers,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        title: input.title,
        head: input.branchName,
        base,
        body: input.body,
        draft: input.draft ?? false
      })
    }
  );

  return {
    url: pr.html_url,
    number: pr.number,
    head: pr.head?.ref ?? input.branchName,
    base: pr.base?.ref ?? base
  };
}
