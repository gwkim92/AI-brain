function normalizeCik(cik: string): string {
  const digits = cik.replace(/[^0-9]/gu, '');
  return digits.padStart(10, '0');
}

export type SecRecentFiling = {
  form: string;
  filedAt: string;
  accessionNumber: string;
};

export async function fetchSecRecentFilings(input: {
  cik: string;
  userAgent?: string;
}): Promise<SecRecentFiling[]> {
  const cik = normalizeCik(input.cik);
  const response = await fetch(`https://data.sec.gov/submissions/CIK${cik}.json`, {
    headers: {
      'User-Agent': input.userAgent || 'jarvis-finance/1.0 (jarvis@example.com)',
      Accept: 'application/json'
    }
  });
  if (!response.ok) {
    throw new Error(`sec_fetch_failed:${response.status}`);
  }

  const payload = (await response.json()) as {
    filings?: {
      recent?: {
        accessionNumber?: string[];
        form?: string[];
        filingDate?: string[];
      };
    };
  };

  const accessions = payload.filings?.recent?.accessionNumber ?? [];
  const forms = payload.filings?.recent?.form ?? [];
  const dates = payload.filings?.recent?.filingDate ?? [];
  const maxLength = Math.min(accessions.length, forms.length, dates.length, 10);

  const filings: SecRecentFiling[] = [];
  for (let index = 0; index < maxLength; index += 1) {
    const accession = accessions[index];
    const form = forms[index];
    const filedAt = dates[index];
    if (!accession || !form || !filedAt) continue;
    filings.push({
      accessionNumber: accession,
      form,
      filedAt
    });
  }
  return filings;
}
