
/**
 * @description
 * github module responsible on the github release
 * 1. github release
 * 2. github tag
 * 3. github change log
 */

const axios = require("axios");
const config = require("../../config");

const axiosInstance = axios.create({
  baseURL: 'https://api.github.com',
  headers: {
    'X-GitHub-Api-Version': '2022-11-28',
    'Authorization': `Bearer ${process.env.NPM_TOKEN}`
  }
})

class Github {
  #repo
  #owner
  #branch

  constructor() {
    const { repo, owner } = config.repository.startsWith('git@') ? {
      owner: config.repository.split(':')[1].split('/')[0],
      repo: config.repository.split(':')[1].split('/')[1].replace('.git', '')
    } : {
      owner: config.repository.replace('https://github.com/', '').split('/')[0],
      repo: config.repository.replace('https://github.com/', '').split('/')[1].replace('.git', '')
    }

    // this.#repo = repo
    // this.#owner = owner


    this.#repo = 'h1-a'
    this.#owner = 'omriLugasi'
    this.#branch = config.branch
  }


  #extractCommitDate(releaseBody) {
    return releaseBody.split('<!--sparks metadata last commit date: ')[1].replace(' -->', '')
  }


  async #getLastRelease() {
    const response = await axiosInstance.get(`/repos/${this.#owner}/${this.#repo}/releases?per_page=1&page=1`)
    return response.data
  }

  async #getCommitsByDate(since){
    const response = await axiosInstance.get(`/repos/${this.#owner}/${this.#repo}/commits/${this.#branch}`)
    const commits = []
    if (new Date(response.data.commit.author.date).getTime() > new Date(since.trim()).getTime()) {
      commits.push(response.data)
      const reviewNextCommit = async (url) => {
        const { data: commit } = await axiosInstance.get(url)
        if (new Date(commit.commit.author.date).getTime() > new Date(since.trim()).getTime()) {
          commits.push(commit)
          if (Array.isArray(commit.parents) && commit.parents.length && commit.parents[0].url) {
            return reviewNextCommit(commit.parents[0].url)
          }
        }
      }
      const commitParents = response.data.parents
      if (Array.isArray(commitParents) && commitParents.length && commitParents[0].url) {
        await reviewNextCommit(commitParents[0].url)
      }
    }

    return commits
  }

  async #createTag(newTag, commitHash) {
    console.log(`Creating new tag ${newTag}`)
    const createdTagResponse = await axiosInstance.post(`/repos/${this.#owner}/${this.#repo}/git/tags`, {
      tag: newTag,
      message: `Create new tag ${newTag} by release sparks`,
      tagger: {
        name: 'release sparks',
        email: 'release-sparks@gmail.com',
        date: new Date().toISOString()
      },
      type: 'commit',
      object: commitHash
    })

    await axiosInstance.post(`/repos/${this.#owner}/${this.#repo}/git/refs`, {
      ref: `refs/tags/${newTag}`,
      sha: createdTagResponse.data.sha
    })
  }

  async #createChangelog(newTag, commits, lastCommit) {
    const titles = [...new Set(commits.map(commit => commit.metadata.title))]
    let message = `Release for tag ${newTag}\n`
    for (const title of titles) {
      const currentCommits = commits.filter(commit => commit.metadata.title === title)
      message += `\n## ${title}`
      for (const commit of currentCommits) {
        message += `\n- ${commit.message} ([${commit.name}](${commit.url})) by (${commit.metadata.committerName})`
      }
    }

    message += `\n\n\n<!--sparks metadata last commit date: ${lastCommit.metadata.date} -->`
    return message
  }

  async #createRelease(newTag, commits, lastCommit) {
    const releaseName = `Release: ${newTag}`
    console.log(`Creating new release ${releaseName}`)
    await axiosInstance.post(`/repos/${this.#owner}/${this.#repo}/releases`, {
      tag_name: newTag,
      target_commitish: this.#branch,
      name: releaseName,
      body: await this.#createChangelog(newTag, commits, lastCommit),
      draft: false,
      prerelease: false,
      generate_release_notes: false
    })
  }

  async release(newTag, commits) {
    const lastCommit = commits.reduce((acc, current) => {
      if (!acc) {
        return current
      }
      return new Date(acc.metadata.date).getTime() > new Date(current.metadata.date) ? acc : current
    }, null)

    newTag = `${newTag}-${new Date().getTime()}`

    await this.#createTag(newTag, lastCommit.metadata.hash)

    await this.#createRelease(newTag, commits, lastCommit)
  }

  /**
   * @description
   * This function should work with github api to extract the commit messages from the last release.
   */
  async getDetails() {
    const [release] = await this.#getLastRelease()

    if (!release) {
      // TODO: if there is no release in the repository
    }
    const since = this.#extractCommitDate(release.body)
    const commits = await this.#getCommitsByDate(since)
    const results = commits.reduce((acc, { sha: currentSha, html_url, commit }) => {
        acc.push({
          message: commit.message,
          url: html_url,
          name: html_url.substring(html_url.length -6 , html_url.length),
          metadata: {
            hash: currentSha,
            date: commit.author.date,
            committerName: commit.committer.name
          }
        })
      return acc
    }, [])

    return { commits: results, tag: release.tag_name.split('-')[0] }
  }

}

exports.Github = Github

