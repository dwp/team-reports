var express = require('express');
var router = express.Router();
var path = require('path');
var Trello = require('node-trello');

var apikey = '86a2eafee0c0c263955734cf48f08ade';
var token = '85d8269f30f9efe4b97d1bb52b612a2fc1d2dd71a182affa948fe56a62c720c0';
var orgId = '576d110461441904ca9927e2';

const inspect = (x) => console.log(x) && x;

const render = (res, view) => (model) => res.render(view, model) && res;

const redirect = (res, route) => () => res.redirect(route) && res;

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
  err ? reject(rpcError(url, opts, err)) : resolve(data);

const trello = (a, t) => new Trello(a, t);

const trelloPromise = (x) => new Promise((resolve, reject) =>
    router.trello.get(x, rpcErrorCheck(x, {}, resolve, reject)));

const trelloPromiseWithOptions = (x, opts) => new Promise((resolve, reject) =>
    router.trello.get(x, opts, rpcErrorCheck(x, opts, resolve, reject)));

const getBoard = (idBoard) =>
    trelloPromise(path.join('/1/boards/', idBoard));

const getBoards = (idOrganization) =>
    trelloPromiseWithOptions('/1/organizations/' + idOrganization + '/boards', { limit: 1000 });

const getBoardLists = (idBoard) =>
    trelloPromiseWithOptions('/1/boards/' + idBoard + '/lists', { filter: 'all', limit: 1000 });

const getBoardCards = (idBoard) =>
    trelloPromiseWithOptions('/1/boards/' + idBoard + '/cards', { filter: 'all', limit: 1000 });

const getBoardActions = (idBoard) =>
    trelloPromiseWithOptions('/1/boards/' + idBoard + '/actions', {
      filter: 'createList,createCard,updateCard:idList,updateCard:closed',
      limit: 1000,
    });

const getListCards = (idList) =>
    trelloPromiseWithOptions('/1/lists/' + idList + '/cards', { filter: 'all', limit: 1000 });

const getAdded = (actions) =>
  actions.filter((x) => x.type === 'createCard');

const getCompleted = (actions) =>
  actions.filter((x) => x.type === 'movedFromBoard' || x.type === 'updateCard:closed');

const createBoardModel = () => (board) => ({
    title: 'Board',
    id: board.id,
    name: board.name,
    desc: board.desc,
    descData: board.descData,
    closed: board.closed,
    idOrganization: board.idOrganization,
    pinned: board.pinned,
    url: board.url,
    shortUrl: board.shortUrl,
    prefs: board.prefs,
    /*
    {
      background: 'blue',
      backgroundImage: null,
      backgroundImageScaled: null,
      backgroundTile: false,
      backgroundBrightness: 'dark',
      backgroundColor: '#0079BF',
      labelNames: {
        green: 'Bootstrap',
        yellow: 'Experiment',
        orange: 'Vision',
        red: '',
        purple: 'Team Infrastructure',
        blue: '',
        sky: 'Conversational Agents',
        lime: '',
        pink: '',
        black: '',
      },
    },
    */
    src: JSON.stringify(board, null, '  '),
  });

const createListModel = () => (list, cards) => ({
    id: list.id,
    name: list.name,
    closed: list.closed,
    idBoard: list.idBoard,
    pos: list.pos,
    subscribed: list.subscribed,
    cards: (createCardsModel()(cards.filter((x) => x.idList === list.id)) || []),
    src: JSON.stringify(list, null, '  '),
  });

const createCardModel = () => (card) => ({
  id: card.id,
  name: card.name,
  closed: card.closed,
  dateLastActivity: new Date(card.dateLastActivity),
  idBoard: card.idBoard,
  idList: card.idList,
  pos: card.pos,
  labels: card.labels,
  subscribed: card.subscribed,
  src: JSON.stringify(card, null, '  '),
});

const createActionModel = () => (action) => ({
  id: action.id,
  type: action.type,
  date: new Date(action.date),
  memberCreator: action.memberCreator,
  data: action.data,
  src: JSON.stringify(action, null, '  '),
});

const createBoardsModel = () => (boards) =>
    boards
      .map((x) => createBoardModel()(x));

const createListsModel = () => (lists, cards) =>
    lists
      .map((x) => createListModel()(x, cards))
      .sort((a, b) => a.pos >= b.pos);

const createCardsModel = () => (cards) =>
    cards
      .map((x) => createCardModel()(x))
      .sort((a, b) => a.pos >= b.pos);

const createActionsModel = () => (actions) =>
    actions
      .map((x) => createActionModel()(x))
      .sort((a, b) => a.date - b.date);

const createBoardListModel = () => (data) => ({
    title: 'Boards',
    boards: createBoardsModel()(data),
  });

const createBoardDetailModel = () => (data) => ({
    title: 'Board Details',
    board: createBoardModel()(data[0]),
    lists: createListsModel()(data[1], data[2]),
  });

const createBoardActionsModel = () => (data) => ({
    title: 'Board Actions',
    board: createBoardModel()(data[0]),
    actions: createActionsModel()(data[1]),
    added: getAdded(createActionsModel()(data[1])),
    completed: getCompleted(createActionsModel()(data[1])),
  });

// middleware

const setup = (req, res, next) =>
  (router.trello = router.trello || trello(apikey, token)) && next();

router.use(setup);

// public

const listBoards = (req, res, next) =>
  getBoards(orgId)
    .then(createBoardListModel(orgId))
    .then(render(res, 'boards'))
    .catch(failWithError(res, next));

const displayBoardDetail = (req, res, next) =>
  Promise.all([
    getBoard(req.params.idBoard),
    getBoardLists(req.params.idBoard),
    getBoardCards(req.params.idBoard),
  ])
    .then(createBoardDetailModel(orgId))
    .then(render(res, 'board'))
    .catch(failWithError(res, next));

const displayBoardActions = (req, res, next) =>
  Promise.all([
    getBoard(req.params.idBoard),
    getBoardActions(req.params.idBoard),
  ])
    .then(createBoardActionsModel(orgId))
    .then(render(res, 'actions'))
    .catch(failWithError(res, next));

router.get('/', listBoards);
router.get('/board/', listBoards);
router.get('/board/:idBoard', displayBoardDetail);
router.get('/board/:idBoard/action/', displayBoardActions);

//router.get('/list/:idList', displayListDetail);
//router.get('/list/:idList/action/', displayListActions);
//router.get('/card/:idCard', displayCardDetail);
//router.get('/card/:idCard/action/', displayCardActions);

// exports

module.exports = router;
