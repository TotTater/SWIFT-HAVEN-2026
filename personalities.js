// What the AI reports -> expression image + score change
const STATUS_INFO = {
  making_progress: { expression: 'pleased',      delta: 1 },
  struggling:      { expression: 'sad',          delta: -1 },
  failing:         { expression: 'disappointed', delta: -2 },
  off_task:        { expression: 'angry',        delta: -1 },
  big_surprise:    { expression: 'shocked',      delta: 0 },
  idle_or_menu:    { expression: 'neutral',      delta: 0 }
};

const NEGATIVE = new Set(['struggling', 'failing', 'off_task']);

const PERSONALITIES = {
  // Cutesy, carefree
  pink: {
    lines: {
      making_progress: [
        'Yay, look at you go!',
        'Ooh, that\'s so cool! Keep going~',
        'You\'re doing amazing, hehe!',
        'Wheee! Nice one!'
      ],
      struggling: [
        'Aw, it\'s okay! You\'ve got this~',
        'Hehe, tricky part? You can do it!',
        'Take your time, no rush!'
      ],
      failing: [
        'Oopsie! That\'s okay, try again!',
        'Aww... it happens! Shake it off~',
        'Whoops! Next time for sure!'
      ],
      off_task: [
        'Ooh, what\'s that? ...wait, weren\'t we doing something?',
        'Hehe, getting distracted? Cutie~',
        'Um, hi? Back to it?'
      ],
      big_surprise: [
        'WOAH! Did you see that?!',
        'Eeee! What was that?!'
      ],
      idle_or_menu: [
        'Hmm hm hm~ I\'ll wait here!',
        'Take your time~'
      ]
    },
    pleas: [
      'Pleeease get back to it? For me?',
      'Come on come on come on~ please?',
      'I believe in you! Just one more try, pretty please?',
      'Don\'t make me sad, okay? Let\'s go~'
    ]
  },

  // Tsundere
  bb: {
    lines: {
      making_progress: [
        'H-hmph. Not bad. Don\'t get a big head.',
        'It\'s not like I\'m impressed or anything!',
        'Fine, that was... decent. Whatever.',
        'D-don\'t look at me! Keep going!'
      ],
      struggling: [
        'Ugh, what are you even doing?! ...Here, focus.',
        'Tch, you\'re hopeless. ...You can do it, idiot.',
        'Do I have to watch you do everything?!'
      ],
      failing: [
        'Seriously?! You are SUCH an idiot!',
        'Tch. ...I wasn\'t worried. Not at all.',
        'Ugh! Don\'t just sit there, get back up!'
      ],
      off_task: [
        'Hey! What are you even looking at?!',
        'Ignoring me? Real mature.',
        'Tch. Get back to work, dummy.'
      ],
      big_surprise: [
        'WH-WHAT?! That startled me, idiot!',
        'Don\'t just scare me like that!'
      ],
      idle_or_menu: [
        '...I\'m not bored. I\'m just waiting.',
        'Hurry up already.'
      ]
    },
    pleas: [
      'H-hey... please just go back to it. ...Not that I care!',
      'I\'m only asking because I... ugh, just do it, okay?!',
      'Don\'t make me say it again... please?',
      'Y-you\'re better than this. Don\'t make me say it twice!'
    ]
  }
};

// Imported characters use Pink's personality until you add their own entry above
function getPersonality(characterId) {
  return PERSONALITIES[characterId] || PERSONALITIES.pink;
}

module.exports = { STATUS_INFO, NEGATIVE, getPersonality };