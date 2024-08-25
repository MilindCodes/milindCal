"""
This is MilindCal - the worlds premier productivity software. The worlds best to do list - without 
even a shadow of a doubt. We create a .txt file for you with all of your tasks for the day listed 
in the order in which they should be done. It's like a daily bucket list... just a lot less interesting.
"""

import datetime


# To-Do list
class Task:
    def __init__(self, task_name, description="", duration=0, importance="!"):

        try:
            duration = int(duration)
        except:
            raise TypeError("duration must be an int or float")

        if not isinstance(task_name, (str, type(None))):
            print(f"Task Name type is {type(task_name)}")
            raise TypeError("task_name must be of type str")

        self.title = task_name

        if not isinstance(description, (str, type(None))):
            print(f"Description type is {type(description)}")
            raise TypeError

        self.description = description

        if not isinstance(duration, (int, float, type(None))):
            print(f"Duration type is {type(duration)}")
            raise TypeError

        self.duration = duration  # how long does the task take to complete?

        if not isinstance(importance, (str, type(None))):
            raise TypeError
        if importance not in ("!", "!!", "!!!"):
            raise TypeError("Input must be one of the following: !, !!, !!!")

        self.importance = importance  # how important is this task? (!, !!, !!!)

        self._date_added = datetime.date.today()

    def __str__(self):
        return f"{self.title}\n{self.description}\n{self.duration}\n{self.importance}\n{self.date_added}\n"

    @property
    def date_added(self):
        return self._date_added.strftime("%B %d, %Y")


def generating_tasks() -> list:  # generate a task and fill in it's attributes properly, and then returns the task
    tasks = []
    while True:
        if input("Another task? ").lower().strip() not in (
            "yes",
            "yeah",
            "yep",
            "y",
            "uh huh",
        ):
            break
        title = input("Task Name: ")
        description = input("Describe task: ")
        duration = input("How long will it take: ")
        importance = input(
            "How important is this task (!, !!, !!!): "
        )  # include string validation

        task = Task(
            task_name=title,
            description=description,
            duration=duration,
            importance=importance,
        )
        tasks.append(task)
    return tasks


def task_sort(tasks: list) -> list:  # sorts the tasks based on their importance level
    sorted_tasks = []
    temp_list = []
    sorting_dictionary = {}

    task_duration = []
    task_importance = []

    for task in tasks:
        task_duration.append(task.duration)
        task_importance.append(task.importance)

    for key, value in zip(task_duration, task_importance):
        sorting_dictionary[key] = value

    for key, value in sorting_dictionary.items():
        score = 1
        if value == "!!!":
            score *= 10
        if value == "!!":
            score *= 5
        if value == "!":
            score *= 2

        score /= key
        temp_list.append(score)

    for i, task in enumerate(tasks):
        sorted_tasks.append({task: temp_list[i]})

    return sorted(sorted_tasks, key=lambda x: list(x.values())[0], reverse=True)


def generate_file(todo_list: list) -> None:
    with open("tasks", "w") as f:
        for _ in todo_list:
            for key in _:
                temp_string = f"{key.title}\n{key.description}\n{key.duration}\n{key.importance}\n{key.date_added}\n\n"
                f.write(temp_string)


def main():

    todo_list = generating_tasks()
    temp_list = task_sort(todo_list)
    generate_file(temp_list)


if __name__ == "__main__":
    main()
