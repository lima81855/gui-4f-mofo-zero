import { getConnectorHealth } from './registry'
import { getVideoComments, getVideoMetadata, searchVideos } from './youtube'

export function getYoutubeResearchHealth() {
  return getConnectorHealth('youtube-research')
}

export async function researchYoutubeComments(query: string, maxVideos = 5) {
  const videos = await searchVideos(query, maxVideos)
  const metadata = await getVideoMetadata(videos.map(video => video.videoId))
  const comments = []

  for (const video of metadata) {
    comments.push(...(await getVideoComments(video.videoId, video.title, video.channelId)))
  }

  return {
    query,
    videos: metadata,
    comments,
  }
}
