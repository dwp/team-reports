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
//     - new ideas
//     - formalised topics
//     - new work items
//     - new items for publication
//     - work items assigned to a topic
//     - work items ready for WIP
//     - work started
//     - items scheduled for publication
//     - work ended
//     - published items
//   process attributes into metrics

const dhm = (t) => {
  var cd = 24 * 60 * 60 * 1000;
  var ch = 60 * 60 * 1000;
  var d = Math.floor(t / cd);
  var h = Math.floor((t - d * cd) / ch);
  var m = Math.round((t - d * cd - h * ch) / 60000);

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

const addDays = (d, days) => {
    var dat = new Date(d.valueOf());
    dat.setDate(dat.getDate() + days);
    return dat;
};

const getCurrentPeriod = (d) => {
  var now = d ? new Date(d) : new Date();
  var dayDiff = 6 - now.getDay();
  var endOfWeek = addDays(now, dayDiff);
  var startOfWeek = addDays(endOfWeek, -5);
  startOfWeek.setUTCHours(0, 0, 0, 0);
  endOfWeek.setUTCHours(23, 59, 59, 999);

  return {
    startdate: startOfWeek,
    enddate: endOfWeek,
  };
};

const inspect = (x) => {
  console.log(typeof x === 'string' ? x : JSON.stringify(x, null, '  '));

  return x;
};

const render = (res, view) => (model) => res.render(view, model) && res;

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

const trelloPromiseWithOptions = (x, opts) => new Promise((resolve, reject) =>
    router.trello.get(x, opts, rpcErrorCheck(x, opts, resolve, reject)));

/*
const trelloPromise = (x) => trelloPromiseWithOptions(x, {});
*/

const getBoardLists = (idBoard) =>
trelloPromiseWithOptions('/1/boards/' + idBoard + '/lists', { filter: 'all', limit: 1000 });

const getCardWithActionData = (idCard) =>
    trelloPromiseWithOptions(path.join('/1/cards/', idCard), {
      'actions_limit': 1000,
      actions: 'createList,createCard,updateCard:idList,updateCard:closed',
      fields: 'name,dateLastActivity,labels',
    });

const expandListWithCardData = (list) =>
    Promise.all((list = list || { cards:[] }).cards.map((x) => getCardWithActionData(x.id)))
      .then((cards) => {
        list.cards = cards;
        return list;
      });

const getListWithCardActions = (idList) =>
    trelloPromiseWithOptions('/1/lists/' + idList, { cards: 'all', limit: 1000 })
      .then(expandListWithCardData);

const cardsInList = (cards) =>
    cards.map((x) => ({
      id: x.id,
      name: x.name,
      labels: x.labels,
      actions: x.actions,
    }));

const cardsByLabel = (cards, filter) => {
  var labels = {};

  filter = filter.map((x) => x.toLowerCase());

  cards.forEach((card) => {
    card.labels.forEach((label) => {
      return ~filter.indexOf(label.name.toLowerCase()) &&
                (labels[label.name.toLowerCase()] = labels[label.name.toLowerCase()] || []).push({
        id: card.id,
        name: card.name,
      });
    });
  });

  return labels;
};

const cardsTimeInList = (cards, idList, period) =>
  cards.map((card) => {
    var enteredList = card.actions
                        .filter((x) => x.type === 'updateCard' && x.data.listAfter && x.data.listAfter.id === idList)
                        .map((x) => new Date(x.date))
                        .sort((a, b) => a - b)[0];
    var created = card.actions
                        .filter((x) => x.type === 'createCard')
                        .map((x) => new Date(x.date))
                        .sort((a, b) => a - b)[0];

    var timeInList = dhm(period.enddate - (enteredList > period.startdate ? enteredList : period.startdate));
    var age = dhm(period.enddate - created);
    var newThisPeriod = enteredList <= period.enddate && enteredList >= period.startdate;

    return {
      id: card.id,
      name: card.name,
      enteredList: enteredList,
      created: created,
      timeInList: timeInList,
      newThisPeriod: newThisPeriod,
      age: age,
    };
  })
  .filter((x) => x.timeInList >= 0);

const cardsNewThisPeriod = (cards, idList, periodend) =>
  cardsTimeInList(cards, idList, periodend)
      .filter((x) => x.newThisPeriod)
      .sort((a, b) => a.enteredList - b.enteredList);

const inProgressMetricDashboard = (d) => (data) => {
  var inProgress = data[0];
  var done = data[1];
  var initialIdeas = data[2];
  var researchIdeas = data[3];
  var ideasForConsideration = data[4];

  // always the last one
  var topics = (data[data.length - 1] || []).map((x) => x.name).filter((x) => x !== 'Ready');

  var allCards = inProgress.cards.concat(done.cards) || [];

  var period = getCurrentPeriod(d);

  return {
    title: 'In progress',
    period: {
      isCurrent: period.enddate > new Date(),
      startdate: period.startdate.toDateString(),
      enddate: period.enddate.toDateString(),
    },
    cardsInProgress: cardsInList(inProgress.cards),
    cardsDone: cardsInList(done.cards),
    cardsInitialIdeas: cardsNewThisPeriod(initialIdeas.cards, initialIdeas.id, period),
    cardsResearchIdeas: cardsNewThisPeriod(researchIdeas.cards, researchIdeas.id, period),
    cardsIdeasForConsideration: cardsNewThisPeriod(ideasForConsideration.cards, ideasForConsideration.id, period),
    cardsByType: cardsByLabel(allCards, ['bootstrap', 'experiment', 'vision'], period),
    cardsByTopic: cardsByLabel(allCards, topics, period),
    cardsTimeInList: cardsTimeInList(allCards, inProgress.id, period),
    cardsNewThisPeriod: cardsNewThisPeriod(allCards, inProgress.id, period),
  };
};

// middleware

const setup = (req, res, next) =>
  (router.trello = router.trello || trello(req.app.locals.config.apikey, req.app.locals.config.token)) && next();

router.use(setup);

// public

const displayInProgressRadiator = (req, res, next) =>
  Promise.all([
    getListWithCardActions(req.app.locals.config.idInProgressList),
    getListWithCardActions(req.app.locals.config.idDoneList),
    getListWithCardActions(req.app.locals.config.idInitialIdeasList),
    getListWithCardActions(req.app.locals.config.idResearchIdeaList),
    getListWithCardActions(req.app.locals.config.idIdeasForConsiderationList),

    getBoardLists(req.app.locals.config.idPlanningBoard),
  ])
    .then(inProgressMetricDashboard(req.query.d))
    .then(render(res, 'inprogress'))
    .catch(failWithError(res, next));

router.get('/', displayInProgressRadiator);

// exports

module.exports = router;
