var express = require('express');
var router = new express.Router();
var path = require('path');
var Trello = require('node-trello');

// given an <idOrganisation>
//   get all boards
//   get all lists with actions
//     - get list of topics on planning board
//   get all cards with actions
//   get all labels
//     - get all topic labels
//     - get all work item type labels
//     - get all publication type labels
//   process actions into historical states and time spent in a state
//     - new ideas [createCard || copyCard: 'Ideas:Initial Ideas']
//     - ideas being looked into [updateCard: 'Ideas:Researching']
//     - ideas being considered [updateCard: 'Ideas:For Consideration']
//     - approved ideas [updateCard: 'Ideas:Planning']
//     - rejected ideas [updateCard: 'Ideas:Planning' + 'closed']
//     - ideas ready to work on [updateCard: 'Ideas:Ready for Work']
//
//     - work items ready for WIP [updateCard: 'Work in Progress:Up Next']
//     - work started [updateCard: 'Work in Progress:In Progress']
//     - work ended [updateCard: 'Work in Progress:Done ****/**']
//
//     - new items for publication [createCard || copyCard: 'Communication:Ideas']
//     - items scheduled for publication [updateCard: 'Communication:Scheduled']
//     - published items [updateCard: 'Communication:Published']
//   process attributes into metrics

const inspect = (x) => {
  console.log('>>' + typeof x === 'string' ? x : JSON.stringify(x, null, '  '));

  return x;
};

const flatten = () => (arr) => arr.reduce((a, b) => a.concat(b), []);

const send = (res) => (model) => res.send(model) && res;

//const redirect = (res, route) => () => res.redirect(route) && res;

const failWithError = (res, next) => (err) => {
  var ex = new Error(typeof err === 'string' ? err : err.message);
  if (err.stack) {
    ex.stack = err.stack;
  }

  return res.status(400) && next(ex);
};

const rpcError = (url, opts, err) => {
  err.url = url;
  err.options = opts;

  console.error('RPC Error Occured:');
  console.error(err);

  return err;
};

const errorCheck = (resolve, reject) => (err, data) =>
  err ? reject(err) : resolve(data);

const rpcErrorCheck = (url, opts, resolve, reject) => (err, data) =>
  errorCheck(resolve, reject)((err ? rpcError(url, opts, err) : err), data);

const trello = (a, t) => new Trello(a, t);

const trelloPromise = (x, opts) => new Promise((resolve, reject) =>
  router.trello.get(x, opts || {}, rpcErrorCheck(x, opts || {}, resolve, reject)));

const setProperty = (x, prop) => (v) => {
  if (v) {
    x[prop] = v;
  }

  return x;
};

const getCardCreatedMetric = (card) =>
  setProperty(card, 'createdDate')(card.actions
                      .filter((x) => ~['createCard', 'copyCard'].indexOf(x.type))
                      .map((x) => new Date(x.date))
                      .sort((a, b) => a - b)[0]);

const getCardClosedMetric = (card) =>
  setProperty(card, 'closedDate')(card.actions
                      .filter((x) => x.type === 'updateCard' && (x.data.card.closed === true && x.data.old.closed === false))
                      .map((x) => new Date(x.date))
                      .sort((a, b) => a - b)[0]);

const getListHistory = (card) =>
  setProperty(card, 'listHistory')(card.actions
                      .filter((x) => ~['createCard', 'copyCard'].indexOf(x.type) || (x.type === 'updateCard' && x.data.listAfter))
                      .map((x) => ({
                        date: new Date(x.date),
                        list: ~['createCard', 'copyCard'].indexOf(x.type) ? x.data.list : x.data.listAfter,
                      }))
                      .sort((a, b) => a.date - b.date));

const analyseCard = (fns) => (card) =>
  fns.reduce((x, fn) => fn(x), card);

const analyseCards = (cards) =>
  cards.map(analyseCard([
    getCardCreatedMetric,
    getCardClosedMetric,
    getListHistory,
  ]));

const getBoardLists = (idBoard) =>
  trelloPromise(path.join('/1/boards/', idBoard, '/lists'), {
    filter: 'all',
    fields: 'closed,idBoard,name,pos',
  });

const getOrganisationBoardLists = (org) =>
  Promise.all(org.boards.map((x) => getBoardLists(x.id)))
    .then(flatten())
    .then(setProperty(org, 'lists'));

const getBoardCards = (idBoard) =>
  trelloPromise(path.join('/1/boards/', idBoard, '/cards'), {
    'actions_limit': 1000,
    actions: 'all',
    filter: 'all',
    fields: 'closed,dateLastActivity,desc,descData,due,idAttachmentCover,idBoard,idChecklists,idLabels,idList,idShort,name,pos,shortUrl,url',
    limit: 1000,
  });

const getOrganisationBoardCards = (org) =>
  Promise.all(org.boards.map((x) => getBoardCards(x.id)))
    .then(flatten())
    .then(analyseCards)
    .then(setProperty(org, 'cards'));

const getBoardLabels = (idBoard) =>
  trelloPromise(path.join('/1/boards/', idBoard, '/labels'), {
    fields: 'color,idBoard,name,uses',
    limit: 1000,
  });

const getOrganisationBoardLabels = (org) =>
  Promise.all(org.boards.map((x) => getBoardLabels(x.id)))
    .then(flatten())
    .then(setProperty(org, 'labels'));

const getTrelloData = (idOrganization) =>
  trelloPromise(path.join('/1/organizations/', idOrganization), {
    boards: 'all',
    'board_fields': 'closed,desc,descData,name,shortUrl,url',
    fields: 'desc,descData,displayName,logoHash,name,products,url,website',
  });

// middleware

const setup = (req, res, next) =>
  (router.trello = router.trello || trello(req.app.locals.config.apikey, req.app.locals.config.token)) && next();

router.use(setup);

// public

const generateModel = (req, res, next) =>
  getTrelloData(req.app.locals.config.idOrganisation)
    .then(getOrganisationBoardLists)
    .then(getOrganisationBoardCards)
    .then(getOrganisationBoardLabels)
    .then(send(res))
    .catch(failWithError(res, next));

router.get('/', generateModel);

// exports

module.exports = router;
