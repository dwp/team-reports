var express = require('express');
var router = express.Router();
var path = require('path');
var Trello = require('node-trello');

var apikey = '86a2eafee0c0c263955734cf48f08ade';
var token = '85d8269f30f9efe4b97d1bb52b612a2fc1d2dd71a182affa948fe56a62c720c0';

var idInProgressList = '57ac37eeadfc6a8db111d430';

var enddate = new Date(2016, 7, 21, 23, 59, 59, 999);

// given an <idOrganisation>
//   get all boards
//   get all lists with actions
//   get all cards with actions
//   process actions into historical states and time spent in a state
//     - created
//     - assigned to a programme
//     - ready for WIP
//     - work started
//     - scheduled for publication
//     - work ended / published
//   process attributes into metrics

const dhm = (t) => {
  var cd = 24 * 60 * 60 * 1000;
  var ch = 60 * 60 * 1000;
  var d = Math.floor(t / cd);
  var h = Math.floor((t - d * cd) / ch);
  var m = Math.round((t - d * cd - h * ch) / 60000);
  var pad = (n) => n < 10 ? '0' + n : n;

  if (m === 60) {
    h++;
    m = 0;
  }

  if (h === 24) {
    d++;
    h = 0;
  }

  return d;
};

const inspect = (x) => {
  console.log(typeof x === 'string' ? x : JSON.stringify(x, null, '  '));

  return x;
};

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

const getCardWithActionData = (idCard) =>
    trelloPromiseWithOptions(path.join('/1/cards/', idCard), {
      'actions_limit': 1000,
      actions: 'createList,createCard,updateCard:idList,updateCard:closed',
      fields: 'name,dateLastActivity,labels',
    });

const expandListWithCardData = (list) =>
    Promise.all(list.cards.map((x) => getCardWithActionData(x.id)))
      .then((cards) => {
        list.cards = cards;
        return list;
      });

const getListWithCardActions = (idList) =>
    trelloPromiseWithOptions('/1/lists/' + idList, { cards: 'all', limit: 1000 })
      .then(expandListWithCardData);

const createListModel = () => (list) => ({
    id: list.id,
    name: list.name,
    closed: list.closed,
    idBoard: list.idBoard,
    pos: list.pos,
    subscribed: list.subscribed,
    cards: list.cards || [],
    src: JSON.stringify(list, null, '  '),
  });

const cardsInProgress = (cards) =>
    cards.map((x) => ({
      id: x.id,
      name: x.name,
      labels: x.labels,
      actions: x.actions,
    }));

const cardsByLabel = (cards) => {
  var labels = {};

  cards.forEach((card) => {
    card.labels.forEach((label) => {
      (labels[label.name] = labels[label.name] || []).push({
        id: card.id,
        name: card.name,
      });
    });
  });

  return labels;
};

const cardsTimeInList = (cards, idList, enddate) =>
  cards.map((card) => {
    var enteredList = card.actions
                        .filter((x) => x.type === 'updateCard' && x.data.listAfter.id === idList)
                        .map((x) => new Date(x.date))
                        .sort((a, b) => a - b)[0];
    var created = card.actions
                        .filter((x) => x.type === 'createCard')
                        .map((x) => new Date(x.date))
                        .sort((a, b) => a - b)[0];

    return {
      id: card.id,
      name: card.name,
      enteredList: enteredList,
      created: created,
      timeInList: dhm(enddate - enteredList),
      age: dhm(enddate - created),
    };
  });

const inProgressMetricDashboard = (idList) => (list) => ({
    title: 'In progress',
    list: createListModel()(list),
    cardsInProgress: cardsInProgress(list.cards || []),
    cardsByLabel: cardsByLabel(list.cards || []),
    cardsTimeInList: cardsTimeInList(list.cards || [], idList, enddate),
    cardsNewThisPeriod: cardsTimeInList(list.cards || [], idList, enddate)
                          .sort((a, b) => a.enteredList - b.enteredList)[0],
  });

// middleware

const setup = (req, res, next) =>
  (router.trello = router.trello || trello(apikey, token)) && next();

router.use(setup);

// public

const listItemsCurrentlyInProgress = (req, res, next) =>
  getListWithCardActions(idInProgressList)
    .then(inProgressMetricDashboard(idInProgressList))
    .then(render(res, 'inprogress'))
    .catch(failWithError(res, next));

router.get('/', listItemsCurrentlyInProgress);

// exports

module.exports = router;
