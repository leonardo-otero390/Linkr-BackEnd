import urlMetadata from 'url-metadata';
import * as postRepository from '../repositories/postRepository.js';
import * as hashtagRepository from '../repositories/hashtagRepository.js';
import * as hashtagPostRepository from '../repositories/hashtagPostRepository.js';
import * as likeRepository from '../repositories/likeRepository.js';
import userRepository from '../repositories/userRepository.js';
import followerRepository from '../repositories/followerRepository.js';

function extractHashtags(text) {
  const hashtags = text.match(/#\w+/g);
  return hashtags ? hashtags.map((hashtag) => hashtag.substring(1)) : [];
}

async function handleHashtags(text, postId) {
  const hashtags = extractHashtags(text);
  if (!hashtags.length) return 0;

  const hashtagsInDb = (await hashtagRepository.findManyByName(hashtags)) || [];
  let hashtagsNotInDb = hashtags;
  if (hashtagsInDb.length) {
    hashtagsNotInDb = hashtags.filter(
      (hashtag) => !hashtagsInDb.find((h) => h.name === hashtag)
    );
  }
  let newHashtagsIds = [];
  if (hashtagsNotInDb.length) {
    newHashtagsIds = await hashtagRepository.insertMany(hashtagsNotInDb);
  }
  newHashtagsIds.forEach((id) => hashtagsInDb.push(id));
  const hashtagsIds = hashtagsInDb.map((h) => h.id);
  await hashtagPostRepository.insertMany({ postId, hashtagsIds });
  return hashtagsIds;
}

export async function create(req, res) {
  const { userId } = res.locals;
  const { text, link } = req.body;
  const existHashtag = text.includes('#');

  try {
    const { title, description, image } = await urlMetadata(link);

    const post = await postRepository.insert({
      text,
      link,
      userId,
      title: title || "Link doesn't have a title",
      description: description || "Link doesn't have a description",
      image: image || 'https://http.cat/404',
    });

    if (existHashtag) await handleHashtags(text, post.id);

    delete post.authorId;

    const user = await userRepository.find(userId);
    delete user.password;
    return res.status(201).send({ post, user, like: [] });
  } catch (error) {
    return res.status(500).send(error.message);
  }
}

export async function remove(req, res) {
  try {
    const { id } = req.params;

    const { userId } = res.locals;

    const postToDelete = await postRepository.get(id);

    if (!postToDelete) {
      return res.status(422).send('There is no post with this id');
    }

    if (postToDelete.authorId !== userId) {
      return res.status(401).send('This post is not yours');
    }

    await postRepository.remove(id);

    return res.sendStatus(200);
  } catch (error) {
    return res.status(500).send(error.message);
  }
}

export async function insertLikesInPostArray(posts) {
  const postsIds = posts.map((post) => post.id);
  const likes = await likeRepository.findByPostIds(postsIds);
  if (!likes) return posts;
  return posts.map((post) => {
    const thisPostLikes = likes.filter((like) => like.postId === post.id);

    return { ...post, likes: thisPostLikes };
  });
}

export async function getPosts(req, res) {
  const { userId } = res.locals;
  try {
    const follows = await followerRepository.getFollows(userId);
    if (!follows.length)
      return res
        .status(404)
        .send("You don't follow anyone yet. Search for new friends!");
    const followedIds = follows.map((follow) => follow.followedId);
    const posts = await postRepository.findManyByAuthorIds([
      userId,
      ...followedIds,
    ]);
    if (!posts) return res.status(404).send('No posts found from your friends');
    const result = await insertLikesInPostArray(posts);
    return res.send(result);
  } catch (err) {
    return res.status(500).send(err.message);
  }
}

export async function getPostsByUserId(req, res) {
  const userId = Number(req.params.id);
  if (Number.isNaN(userId))
    return res.status(422).send('User id must be a number');

  try {
    const user = await userRepository.find(userId);
    if (!user) return res.status(404).send('User not found');

    const posts = await postRepository.findManyByUserId(userId);
    if (!posts) return res.status(404).send('This user has no posts');

    const objectResult = await insertLikesInPostArray(posts);

    return res.send(objectResult);
  } catch (err) {
    return res.status(500).send(err.message);
  }
}

export async function toggleLikePost(req, res) {
  const { id } = req.params;

  const { userId } = res.locals;

  try {
    const post = await postRepository.get(id);

    if (!post) {
      return res.status(422).send("This post doesn't exist");
    }

    await likeRepository.toggle(userId, id);

    return res.sendStatus(200);
  } catch (error) {
    console.error(error);
    return res.sendStatus(500);
  }
}
